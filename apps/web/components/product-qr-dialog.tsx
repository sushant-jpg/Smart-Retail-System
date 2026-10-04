"use client";
/* eslint-disable @next/next/no-img-element -- the protected QR SVG is loaded from an authenticated blob URL */

import { useEffect, useState } from "react";
import { Download, Printer, QrCode, X } from "lucide-react";
import { Badge, Button, Card, ProductVisual } from "@/components/ui";
import { ApiError, apiRequestBlob } from "@/lib/api";
import { money } from "@/lib/format";
import { productAccent, productImage, productInitials, type CatalogProduct } from "@/lib/retail";

export function ProductQrDialog({ product }: { product: CatalogProduct }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => () => {
    if (qrUrl) URL.revokeObjectURL(qrUrl);
  }, [qrUrl]);

  async function generate() {
    setOpen(true);
    setLoading(true);
    setError("");
    if (qrUrl) URL.revokeObjectURL(qrUrl);
    setQrUrl("");
    try {
      const image = await apiRequestBlob(`/products/${encodeURIComponent(product._id)}/label`);
      if (image.type !== "image/svg+xml") throw new Error("The QR service returned an unsupported image format.");
      setQrUrl(URL.createObjectURL(image));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not generate this product QR code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadPng() {
    if (!qrUrl) return;
    try {
      const image = new Image();
      image.src = qrUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PNG export is unavailable in this browser.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The QR image could not be converted to PNG."));
      }, "image/png"));
      const url = URL.createObjectURL(png);
      const link = document.createElement("a");
      link.href = url;
      link.download = `smartretail-${product.slug}-qr.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "QR download failed. Please try again.");
    }
  }

  return <>
    <Button type="button" variant="secondary" onClick={() => void generate()}><QrCode size={15} />Generate QR</Button>
    {open && <div className="qr-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <Card className="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="product-qr-title" aria-busy={loading}>
        <div className="flex items-start justify-between gap-3">
          <div><p className="eyebrow">Secure product label</p><h2 id="product-qr-title" className="mt-1 text-xl font-bold">Product QR code</h2></div>
          <Button type="button" variant="ghost" className="!h-9 !w-9 !px-0" aria-label="Close QR dialog" onClick={() => setOpen(false)}><X size={17} /></Button>
        </div>
        <div className="qr-product-summary">
          <ProductVisual initials={productInitials(product.name)} image={productImage(product)} alt={product.name} accent={productAccent} className="!h-20 !w-20 !rounded-xl" />
          <div className="min-w-0"><h3 className="font-bold">{product.name}</h3><p className="mt-1 text-xs text-muted">SKU {product.sku}</p><p className="mt-1 font-semibold">{money(product.sellingPrice)}</p></div>
        </div>
        <div className="qr-label-print" data-qr-print>
          <div className="qr-code-frame" aria-live="polite">
            {loading && <p role="status" className="p-6 text-sm text-muted">Generating signed QR…</p>}
            {!loading && error && <div role="alert" className="p-5 text-center"><p className="text-sm text-red-700">{error}</p><Button type="button" variant="secondary" className="mt-3" onClick={() => void generate()}>Retry</Button></div>}
            {!loading && !error && qrUrl && <img data-testid="product-qr-code" src={qrUrl} alt={`Signed QR code for ${product.name}`} />}
          </div>
          <div className="qr-print-caption"><strong>{product.name}</strong><span>SKU {product.sku}</span><span>{money(product.sellingPrice)}</span></div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2 qr-actions">
          <Button type="button" variant="secondary" disabled={!qrUrl || loading} onClick={() => void downloadPng()}><Download size={15} />Download PNG</Button>
          <Button type="button" variant="secondary" disabled={!qrUrl || loading} onClick={() => window.print()}><Printer size={15} />Print label</Button>
        </div>
        <p className="mt-3 text-xs text-muted">This QR contains a signed public product reference. Product identity, price, and stock are verified by the server when scanned.</p>
        {!loading && !error && qrUrl && <Badge tone="success" className="mt-3">Signed QR ready</Badge>}
      </Card>
    </div>}
  </>;
}
