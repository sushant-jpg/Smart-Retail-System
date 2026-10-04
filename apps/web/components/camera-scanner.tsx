"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, RefreshCw } from "lucide-react";
import { Button, Card } from "@/components/ui";

type Detection = { rawValue?: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detection[]> };
type DetectorConstructor = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};
type BarcodeDetectorWindow = Window & { BarcodeDetector?: DetectorConstructor };

const scanFormats = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "codabar", "itf"];

function cameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "Camera permission was denied. Allow camera access in browser settings or enter the code manually.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera is available. Connect a camera or enter the code manually.";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "The camera is unavailable or already in use by another application.";
  return "The camera could not start. Enter the barcode, SKU, or signed QR manually.";
}

export function CameraScanner({ onCode }: { onCode: (code: string) => void | Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const timerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const scanInProgressRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Camera is off. Start it when you are ready to scan.");

  const stop = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    detectorRef.current = null;
    scanInProgressRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
  }, []);

  const stopManually = useCallback(() => {
    stop();
    setStatus("Camera stopped. You can restart it or enter the code manually.");
  }, [stop]);

  useEffect(() => stop, [stop]);

  const start = useCallback(async (deviceId = selectedDevice) => {
    stop();
    setStarting(true);
    setError("");
    setStatus("");

    const localHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (!window.isSecureContext && !localHost) {
      setError("Camera scanning requires HTTPS or localhost. Enter the code manually on this connection.");
      setStarting(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not supported in this browser. Enter the code manually.");
      setStarting(false);
      return;
    }
    const Detector = (window as BarcodeDetectorWindow).BarcodeDetector;
    if (!Detector) {
      setError("This browser cannot decode camera QR/barcodes. Use a hardware scanner or enter the code manually.");
      setStarting(false);
      return;
    }

    const generation = generationRef.current;
    let stream: MediaStream;
    try {
      const supported = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : scanFormats;
      const formats = scanFormats.filter((format) => supported.includes(format));
      if (!formats.length) {
        setError("This browser does not support QR or common barcode formats. Enter the code manually.");
        setStarting(false);
        return;
      }
      const detector = new Detector({ formats });
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      detectorRef.current = detector;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      const cameraDevices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
      setDevices(cameraDevices);
      const activeDevice = stream.getVideoTracks()[0]?.getSettings().deviceId;
      setSelectedDevice(deviceId || activeDevice || cameraDevices[0]?.deviceId || "");
      scanInProgressRef.current = false;
      setRunning(true);
      setStarting(false);
      setStatus("Camera ready. The first detected code will be checked by the server.");
      timerRef.current = window.setInterval(async () => {
        const activeDetector = detectorRef.current;
        if (!activeDetector || !videoRef.current || videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || scanInProgressRef.current) return;
        scanInProgressRef.current = true;
        try {
          const value = (await activeDetector.detect(videoRef.current)).find((result) => result.rawValue?.trim())?.rawValue?.trim();
          if (value) {
            stop();
            setStatus("Code detected. Validating with the server…");
            await onCode(value);
          } else {
            scanInProgressRef.current = false;
          }
        } catch {
          stop();
          setError("Camera scanning stopped unexpectedly. Restart the scanner or enter the code manually.");
        }
      }, 240);
    } catch (cause) {
      if (generation === generationRef.current) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setRunning(false);
        setStarting(false);
        setError(cameraError(cause));
      }
    }
  }, [onCode, selectedDevice, stop]);

  return <Card className="p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold">Camera scanner</h3><p className="mt-1 text-xs text-muted">Camera starts only when you press Start scanner.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {devices.length > 1 && <label className="text-xs text-muted">Camera<select className="field mt-1 !h-9 min-w-36" aria-label="Choose camera" value={selectedDevice} onChange={(event) => { const nextDevice = event.target.value; setSelectedDevice(nextDevice); if (running) void start(nextDevice); }}>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>}
        {running
          ? <Button type="button" variant="secondary" onClick={stopManually}><CameraOff size={15} />Stop scanner</Button>
          : <Button type="button" disabled={starting} onClick={() => void start()}><Camera size={15} />{starting ? "Starting…" : "Start scanner"}</Button>}
      </div>
    </div>
    <div className={`relative overflow-hidden rounded-2xl bg-black ${running ? "" : "hidden"}`}>
      <video ref={videoRef} className="camera-video" autoPlay muted playsInline aria-label="Live camera preview" />
      {running && <div className="camera-scan-frame" aria-hidden="true" />}
    </div>
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {!error && status && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted">{!running && status.startsWith("Code detected") ? <RefreshCw size={14} /> : null}{status}</p>}
    {running && <p className="mt-2 text-xs text-muted">Point the camera at a product QR or supported barcode. The camera stops after one detection to prevent duplicate scans.</p>}
  </Card>;
}
