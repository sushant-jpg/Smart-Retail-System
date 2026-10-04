/* eslint-disable @next/next/no-img-element -- product images may use any validated HTTPS URL or local asset path */
import { useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/format";

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={cn("button", `button-${variant}`, className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "success" | "warning" | "danger" | "neutral" | "info"; className?: string }) {
  return <span className={cn("badge", `badge-${tone}`, className)}>{children}</span>;
}

export function ProductVisual({ initials, accent, image, alt, className }: { initials: string; accent: string; image?: string; alt?: string; className?: string }) {
  const [failedImage, setFailedImage] = useState("");
  const imageFailed = failedImage === image;
  const showImage = Boolean(image) && !imageFailed;
  return (
    <div className={cn("product-visual bg-gradient-to-br", accent, className)}>
      {showImage ? <img className="product-visual-image" src={image} alt={alt ?? initials} loading="lazy" onError={() => setFailedImage(image ?? "")} /> : <>
        <span aria-label={alt ?? initials}>{initials}</span>
        <i aria-hidden="true" />
      </>}
    </div>
  );
}

export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p></div>;
}
