// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraScanner } from "./camera-scanner";

function cameraMocks(detect: () => Promise<Array<{ rawValue: string }>>) {
  const track = { stop: vi.fn(), getSettings: () => ({ deviceId: "camera-1" }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([{ kind: "videoinput", deviceId: "camera-1", label: "Rear camera" }]) },
  });
  class TestBarcodeDetector {
    static getSupportedFormats = async () => ["qr_code", "ean_13"];
    detect = vi.fn(detect);
  }
  Object.defineProperty(window, "BarcodeDetector", { configurable: true, value: TestBarcodeDetector });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => HTMLMediaElement.HAVE_CURRENT_DATA });
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get() { return (this as HTMLMediaElement & { testStream?: MediaStream }).testStream ?? null; },
    set(value: MediaStream | null) { (this as HTMLMediaElement & { testStream?: MediaStream }).testStream = value ?? undefined; },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  return { getUserMedia, track };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "BarcodeDetector");
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(HTMLMediaElement.prototype, "readyState");
  Reflect.deleteProperty(HTMLMediaElement.prototype, "srcObject");
});

describe("CameraScanner", () => {
  it("sends a detected QR/barcode value once and releases the camera", async () => {
    const { getUserMedia, track } = cameraMocks(async () => [{ rawValue: "sr:v1:signed-payload:signature" }]);
    const onCode = vi.fn();
    render(<CameraScanner onCode={onCode} />);
    fireEvent.click(screen.getByRole("button", { name: /^Start scanner$/ }));

    await waitFor(() => expect(onCode).toHaveBeenCalledWith("sr:v1:signed-payload:signature"));
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: false,
      video: expect.objectContaining({ facingMode: { ideal: "environment" } }),
    }));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Stop scanner" })).not.toBeInTheDocument();
  });

  it("explains camera permission failures and leaves manual lookup available", async () => {
    const { getUserMedia } = cameraMocks(async () => []);
    getUserMedia.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    render(<CameraScanner onCode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Start scanner$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Camera permission was denied");
  });
});
