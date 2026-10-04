"use client";

import { useState, type ReactNode } from "react";
import { Banknote, Check, CreditCard, QrCode, Smartphone, X } from "lucide-react";
import { ApiError, apiRequest, newIdempotencyKey } from "@/lib/api";
import { money } from "@/lib/format";
import { Button } from "@/components/ui";

type CartItem = { productId: string; quantity: number };
type PaymentMethod = "CASH" | "CARD" | "QR" | "WALLET";
type QuoteLine = { productId: string; name: string; quantity: number; unitPrice: number; total: number };
type CheckoutQuote = { items: QuoteLine[]; subtotal: number; discount: number; tax: number; total: number; paymentMethod: PaymentMethod };
type ReceiptLine = { name: string; quantity: number; total: number };
type SaleReceipt = { saleNumber: string; verificationCode: string; total: number; paymentMethod: PaymentMethod; status?: string; saleStatus?: string; items?: ReceiptLine[] };
type AttemptResponse = { paymentAttemptId: string; state: string; quote: CheckoutQuote; sale?: SaleReceipt };
type ConfirmResponse = { paymentStatus: string; sale?: SaleReceipt; message?: string };

const methods: Array<{ id: PaymentMethod; label: string; icon: typeof Banknote }> = [
  { id: "CASH", label: "Cash", icon: Banknote },
  { id: "CARD", label: "Card", icon: CreditCard },
  { id: "QR", label: "QR", icon: QrCode },
  { id: "WALLET", label: "Wallet", icon: Smartphone },
];

export function CheckoutDialog({
  storeId,
  items,
  customerId,
  disabled,
  children,
  onComplete,
}: {
  storeId: string;
  items: CartItem[];
  customerId?: string;
  disabled?: boolean;
  children: ReactNode;
  onComplete?: (sale: SaleReceipt) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CARD");
  const [promotionCode, setPromotionCode] = useState("");
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [attempt, setAttempt] = useState<AttemptResponse | null>(null);
  const [sale, setSale] = useState<SaleReceipt | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  function openDialog() {
    setError("");
    setOpen(true);
  }

  async function createAttempt() {
    setLoading(true);
    setError("");
    setPriceChanged(false);
    const key = idempotencyKey || newIdempotencyKey();
    setIdempotencyKey(key);
    try {
      const result = await apiRequest<AttemptResponse>("/sales/checkout", {
        method: "POST",
        headers: { "idempotency-key": key },
        body: {
          storeId,
          ...(customerId ? { customerId } : {}),
          items,
          ...(promotionCode.trim() ? { promotionCode: promotionCode.trim() } : {}),
          loyaltyPoints,
          paymentMethod,
        },
      });
      setAttempt(result);
      if (result.sale) setSale(result.sale);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Checkout could not be prepared. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmPayment() {
    if (!attempt) return;
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<ConfirmResponse>(`/sales/checkout/${attempt.paymentAttemptId}/confirm`, { method: "POST" });
      if (result.paymentStatus === "DECLINED") {
        setAttempt({ ...attempt, state: "DECLINED" });
        setError(result.message ?? "Payment was declined. Start a new attempt to retry.");
        return;
      }
      if (!result.sale) throw new Error("The approved payment response did not include its sale.");
      setSale(result.sale);
      setAttempt({ ...attempt, state: "APPROVED", sale: result.sale });
      onComplete?.(result.sale);
    } catch (cause) {
      if (cause instanceof ApiError && cause.detail.code === "PRICE_CHANGED") {
        const changed = cause.detail.details as { quote?: CheckoutQuote } | undefined;
        if (changed?.quote) {
          setAttempt({ ...attempt, quote: changed.quote });
          setPriceChanged(true);
        }
      }
      setError(cause instanceof ApiError ? cause.message : "Payment could not be confirmed. Retry safely.");
    } finally {
      setLoading(false);
    }
  }

  async function loadReceipt() {
    if (!sale) return;
    setReceiptLoading(true);
    setError("");
    try {
      const receipt = await apiRequest<SaleReceipt>(`/receipts/${encodeURIComponent(sale.saleNumber)}`);
      setSale(receipt);
      setReceipt(receipt);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The sale completed, but the receipt could not be loaded.");
    } finally {
      setReceiptLoading(false);
    }
  }

  function retryPayment() {
    setAttempt(null);
    setSale(null);
    setIdempotencyKey("");
    setError("");
  }

  function closeDialog() {
    if (loading) return;
    setOpen(false);
    if (!sale) {
      setAttempt(null);
      setIdempotencyKey("");
    }
  }

  return <>
    <Button disabled={disabled || !storeId || !items.length} onClick={openDialog}>{children}</Button>
    {open && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
        <header className="modal-head">
          <div><h3 id="checkout-title">{sale ? "Sale complete" : "Checkout"}</h3><p className="mt-1 text-[11px] text-muted">Prices, discounts, loyalty and stock are validated by the server.</p></div>
          <button className="icon-button -mr-2 -mt-2" onClick={closeDialog} aria-label="Close checkout" disabled={loading}><X size={18} /></button>
        </header>
        {sale ? <div className="p-6 text-center">
          <div className="success-check"><Check size={28} /></div>
          <h4 className="mt-3 text-lg font-bold">Payment approved</h4>
          <p className="mt-2 text-sm">Sale <strong>{sale.saleNumber}</strong></p>
          <div className="my-4 rounded-xl border border-line p-4 text-left text-xs">
            <p className="m-0 flex justify-between"><span>Total paid</span><strong>{money(sale.total)}</strong></p>
            <p className="mt-2 flex justify-between"><span>Method</span><strong>{sale.paymentMethod}</strong></p>
            <p className="mt-2 flex justify-between"><span>Receipt verification</span><strong>{sale.verificationCode}</strong></p>
            <p className="mb-0 mt-2 flex justify-between"><span>Status</span><strong>{sale.status ?? sale.saleStatus}</strong></p>
          </div>
          {receipt?.items && <div className="mb-4 rounded-xl bg-canvas p-3 text-left text-xs"><strong>Retrieved receipt items</strong>{receipt.items.map((line, index) => <p className="mb-0 mt-2 flex justify-between" key={`${line.name}-${index}`}><span>{line.quantity} × {line.name}</span><strong>{money(line.total)}</strong></p>)}</div>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={receiptLoading} onClick={loadReceipt}>{receiptLoading ? "Loading…" : "Retrieve receipt"}</Button>
            <Button className="flex-1" onClick={() => { setOpen(false); setAttempt(null); setSale(null); setIdempotencyKey(""); }}>Done</Button>
          </div>
          {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
        </div> : <>
          {!attempt || attempt.state === "DECLINED" ? <div className="modal-body space-y-4">
            <label className="block text-xs font-semibold">Promotion code<input className="field mt-1.5" value={promotionCode} onChange={(event) => setPromotionCode(event.target.value)} placeholder="Optional code" disabled={Boolean(attempt)} /></label>
            <label className="block text-xs font-semibold">Loyalty points to redeem<input className="field mt-1.5" type="number" min={0} step={1} value={loyaltyPoints} onChange={(event) => setLoyaltyPoints(Math.max(0, Number(event.target.value)))} disabled={Boolean(attempt)} /></label>
            <div><p className="mb-2 text-xs font-semibold">Payment method</p><div className="payment-grid">{methods.map(({ id, label, icon: Icon }) => <button key={id} type="button" disabled={Boolean(attempt)} onClick={() => setPaymentMethod(id)} className={`payment-method ${paymentMethod === id ? "selected" : ""}`}><Icon size={18} />{label}{paymentMethod === id && <Check size={14} className="ml-auto" />}</button>)}</div></div>
            {attempt?.state === "DECLINED" && <p role="status" className="text-xs text-amber-800">The previous simulation attempt was declined. A new attempt will receive a new idempotency key.</p>}
          </div> : <div className="modal-body">
            <h4 className="mb-3 text-sm font-bold">Server-confirmed order</h4>
            {priceChanged && <p className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="status">The price or checkout eligibility changed. Review the updated items and total below; payment was not taken. Confirm again to proceed at the current total of {money(attempt.quote.total)}.</p>}
            <div className="space-y-2">{attempt.quote.items.map((line) => <div className="flex justify-between gap-3 text-xs" key={line.productId}><span>{line.quantity} × {line.name} ({money(line.unitPrice)})</span><strong>{money(line.total)}</strong></div>)}</div>
            <div className="mt-4 space-y-2 border-t border-line pt-3 text-xs"><p className="m-0 flex justify-between"><span>Subtotal</span><strong>{money(attempt.quote.subtotal)}</strong></p><p className="m-0 flex justify-between"><span>Discount</span><strong>−{money(attempt.quote.discount)}</strong></p><p className="m-0 flex justify-between"><span>Tax</span><strong>{money(attempt.quote.tax)}</strong></p><p className="m-0 flex justify-between text-sm"><span>Total</span><strong>{money(attempt.quote.total)}</strong></p></div>
            <p className="mb-0 mt-4 text-[10px] text-muted">Simulation only. No real financial provider is connected.</p>
          </div>}
          {error && <p role="alert" className="mx-5 mb-0 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
          <footer className="modal-foot">
            <Button variant="secondary" onClick={closeDialog} disabled={loading}>Cancel</Button>
            {!attempt || attempt.state === "DECLINED"
              ? <Button onClick={attempt ? retryPayment : createAttempt} disabled={loading}>{loading ? "Validating…" : attempt ? "Start new attempt" : "Validate checkout"}</Button>
              : <Button onClick={confirmPayment} disabled={loading}>{loading ? "Processing…" : `${priceChanged ? "Confirm updated" : "Confirm"} ${money(attempt.quote.total)}`}</Button>}
          </footer>
        </>}
      </section>
    </div>}
  </>;
}
