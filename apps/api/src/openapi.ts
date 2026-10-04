export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "SmartRetail API", version: "0.1.0", description: "Transactional retail platform API. All monetary values are integer minor units." },
  tags: [
    { name: "Auth" }, { name: "Catalogue" }, { name: "Inventory" }, { name: "Commerce" },
    { name: "Procurement" }, { name: "Engagement" }, { name: "Administration" },
  ],
  servers: [{ url: "http://localhost:4000" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: { type: "object", properties: { success: { const: false }, error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } } } } },
    },
  },
  paths: {
    "/health/live": { get: { summary: "Liveness probe", responses: { "200": { description: "Process is live" } } } },
    "/health/ready": { get: { summary: "Dependency readiness", responses: { "200": { description: "All dependencies ready" }, "503": { description: "A dependency is unavailable" } } } },
    "/api/v1/auth/login": { post: { summary: "Authenticate", responses: { "200": { description: "Authenticated" }, "401": { description: "Invalid credentials" } } } },
    "/api/v1/auth/refresh": { post: { summary: "Rotate the refresh token", tags: ["Auth"], responses: { "200": { description: "Session rotated" }, "401": { description: "Invalid, expired, or reused token" } } } },
    "/api/v1/auth/forgot-password": { post: { summary: "Request a password reset", tags: ["Auth"], responses: { "200": { description: "Request accepted regardless of account existence" } } } },
    "/api/v1/products": { get: { summary: "Search products", responses: { "200": { description: "Paginated products" } } } },
    "/api/v1/products/lookup/{code}": { get: { summary: "Resolve a SKU, barcode, or signed product QR", tags: ["Catalogue"], parameters: [{ in: "path", name: "code", required: true, schema: { type: "string" } }], responses: { "200": { description: "Product" }, "404": { description: "No matching product" } } } },
    "/api/v1/inventory": { get: { summary: "List per-store inventory", tags: ["Inventory"], security: [{ bearerAuth: [] }], responses: { "200": { description: "Inventory balances" }, "403": { description: "Store access denied" } } } },
    "/api/v1/inventory/transfers": { post: { summary: "Transfer stock atomically between stores", tags: ["Inventory"], security: [{ bearerAuth: [] }], parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } }], responses: { "201": { description: "Stock transferred" }, "409": { description: "Insufficient stock or duplicate in progress" } } } },
    "/api/v1/sales/checkout": { post: { summary: "Create an idempotent sale", security: [{ bearerAuth: [] }], parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } }], responses: { "201": { description: "Sale completed" }, "409": { description: "Insufficient inventory or duplicate in progress" } } } },
    "/api/v1/refunds": { post: { summary: "Request a validated partial or full refund", tags: ["Commerce"], security: [{ bearerAuth: [] }], responses: { "201": { description: "Refund requested" }, "422": { description: "Quantity or amount exceeds the sale" } } } },
    "/api/v1/purchase-orders": { post: { summary: "Create a purchase order", tags: ["Procurement"], security: [{ bearerAuth: [] }], responses: { "201": { description: "Draft purchase order" } } } },
    "/api/v1/purchase-orders/{id}/receive": { post: { summary: "Receive goods and create inventory movements", tags: ["Procurement"], security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }, { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } }], responses: { "200": { description: "Goods received" }, "409": { description: "Order state conflict" } } } },
    "/api/v1/loyalty/me": { get: { summary: "View points, tier, and immutable history", tags: ["Engagement"], security: [{ bearerAuth: [] }], responses: { "200": { description: "Loyalty account" } } } },
    "/api/v1/notifications": { get: { summary: "List notifications and unread count", tags: ["Engagement"], security: [{ bearerAuth: [] }], responses: { "200": { description: "Notifications" } } } },
    "/api/v1/receipts/verify/{code}": { get: { summary: "Verify a receipt without exposing its line items", tags: ["Commerce"], parameters: [{ in: "path", name: "code", required: true, schema: { type: "string" } }], responses: { "200": { description: "Verified receipt metadata" }, "404": { description: "Not verified" } } } },
  },
};
