(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/apps/web/components/auth-provider.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AuthProvider",
    ()=>AuthProvider,
    "useAuth",
    ()=>useAuth
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/lib/api.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature();
"use client";
;
;
const AuthContext = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createContext"])(null);
let sessionRestorePromise = null;
function restoreSession() {
    if (!sessionRestorePromise) {
        sessionRestorePromise = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["apiRequest"])("/auth/refresh", {
            method: "POST",
            retryAuth: false
        }).finally(()=>{
            sessionRestorePromise = null;
        });
    }
    return sessionRestorePromise;
}
function AuthProvider({ children }) {
    _s();
    const [user, setUser] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(true);
    const authRequestVersion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "AuthProvider.useEffect": ()=>{
            const version = authRequestVersion.current;
            restoreSession().then({
                "AuthProvider.useEffect": (result)=>{
                    if (version !== authRequestVersion.current) return;
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setAccessToken"])(result.accessToken);
                    setUser(result.user);
                }
            }["AuthProvider.useEffect"]).catch({
                "AuthProvider.useEffect": ()=>{
                    if (version !== authRequestVersion.current) return;
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setAccessToken"])(null);
                    setUser(null);
                }
            }["AuthProvider.useEffect"]).finally({
                "AuthProvider.useEffect": ()=>{
                    if (version === authRequestVersion.current) setLoading(false);
                }
            }["AuthProvider.useEffect"]);
        }
    }["AuthProvider.useEffect"], []);
    const value = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "AuthProvider.useMemo[value]": ()=>({
                user,
                loading,
                login: ({
                    "AuthProvider.useMemo[value]": async (email, password)=>{
                        const version = ++authRequestVersion.current;
                        try {
                            const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["apiRequest"])("/auth/login", {
                                method: "POST",
                                body: {
                                    email,
                                    password
                                },
                                retryAuth: false
                            });
                            if (version !== authRequestVersion.current) throw new Error("Sign-in was superseded by a newer authentication action");
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setAccessToken"])(result.accessToken);
                            setUser(result.user);
                            return result.user;
                        } finally{
                            if (version === authRequestVersion.current) setLoading(false);
                        }
                    }
                })["AuthProvider.useMemo[value]"],
                logout: ({
                    "AuthProvider.useMemo[value]": async ()=>{
                        const version = ++authRequestVersion.current;
                        try {
                            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["apiRequest"])("/auth/logout", {
                                method: "POST",
                                retryAuth: false
                            });
                        } finally{
                            if (version === authRequestVersion.current) {
                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setAccessToken"])(null);
                                setUser(null);
                                setLoading(false);
                            }
                        }
                    }
                })["AuthProvider.useMemo[value]"]
            })
    }["AuthProvider.useMemo[value]"], [
        loading,
        user
    ]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(AuthContext.Provider, {
        value: value,
        children: children
    }, void 0, false, {
        fileName: "[project]/apps/web/components/auth-provider.tsx",
        lineNumber: 69,
        columnNumber: 10
    }, this);
}
_s(AuthProvider, "BkwUuwQOY8WwUKbn+iqv6Wi4OnE=");
_c = AuthProvider;
function useAuth() {
    _s1();
    const value = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useContext"])(AuthContext);
    if (!value) throw new Error("useAuth must be used inside AuthProvider");
    return value;
}
_s1(useAuth, "ksutO2/Ix3UeCrGnhyM+QEP505Y=");
var _c;
__turbopack_context__.k.register(_c, "AuthProvider");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/web/components/providers.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Providers",
    ()=>Providers
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$queryClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/query-core/build/modern/queryClient.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/QueryClientProvider.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$components$2f$auth$2d$provider$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/components/auth-provider.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
function Providers({ children }) {
    _s();
    const [client] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])({
        "Providers.useState": ()=>new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$queryClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["QueryClient"]({
                defaultOptions: {
                    queries: {
                        staleTime: 30_000,
                        retry: 1
                    }
                }
            })
    }["Providers.useState"]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["QueryClientProvider"], {
        client: client,
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$components$2f$auth$2d$provider$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AuthProvider"], {
            children: children
        }, void 0, false, {
            fileName: "[project]/apps/web/components/providers.tsx",
            lineNumber: 9,
            columnNumber: 47
        }, this)
    }, void 0, false, {
        fileName: "[project]/apps/web/components/providers.tsx",
        lineNumber: 9,
        columnNumber: 10
    }, this);
}
_s(Providers, "KWw5syPdZh5X8XzBddEwyZ3p8bw=");
_c = Providers;
var _c;
__turbopack_context__.k.register(_c, "Providers");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/web/lib/api.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ApiError",
    ()=>ApiError,
    "apiRequest",
    ()=>apiRequest,
    "apiRequestBlob",
    ()=>apiRequestBlob,
    "getAccessToken",
    ()=>getAccessToken,
    "newIdempotencyKey",
    ()=>newIdempotencyKey,
    "setAccessToken",
    ()=>setAccessToken
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
class ApiError extends Error {
    status;
    detail;
    constructor(status, detail){
        super(detail.message), this.status = status, this.detail = detail;
        this.name = "ApiError";
    }
}
const API_URL = ("TURBOPACK compile-time value", "http://127.0.0.1:4001/api/v1") ?? "http://localhost:4000/api/v1";
let accessToken = null;
let refreshPromise = null;
function setAccessToken(token) {
    accessToken = token;
    if ("TURBOPACK compile-time truthy", 1) {
        if (token) sessionStorage.setItem("smartretail-access", token);
        else sessionStorage.removeItem("smartretail-access");
    }
}
function getAccessToken() {
    if (!accessToken && ("TURBOPACK compile-time value", "object") !== "undefined") accessToken = sessionStorage.getItem("smartretail-access");
    return accessToken;
}
function refreshAccessToken() {
    if (!refreshPromise) {
        refreshPromise = fetch(`${API_URL}/auth/refresh`, {
            method: "POST",
            credentials: "include"
        }).then(async (response)=>{
            if (!response.ok) return null;
            const payload = await response.json();
            return payload.data.accessToken;
        }).finally(()=>{
            refreshPromise = null;
        });
    }
    return refreshPromise;
}
async function apiRequest(path, options = {}) {
    const token = getAccessToken();
    const headers = new Headers(options.headers);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
        credentials: "include",
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (response.status === 401 && options.retryAuth !== false && path !== "/auth/refresh") {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
            setAccessToken(refreshedToken);
            return apiRequest(path, {
                ...options,
                retryAuth: false
            });
        }
        setAccessToken(null);
    }
    const payload = await response.json().catch(()=>null);
    if (!response.ok || !payload?.success) throw new ApiError(response.status, payload?.error ?? {
        code: "REQUEST_FAILED",
        message: "The request could not be completed"
    });
    return payload.data;
}
async function apiRequestBlob(path, options = {}) {
    const token = getAccessToken();
    const headers = new Headers(options.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
        credentials: "include",
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (response.status === 401 && options.retryAuth !== false && path !== "/auth/refresh") {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
            setAccessToken(refreshedToken);
            return apiRequestBlob(path, {
                ...options,
                retryAuth: false
            });
        }
        setAccessToken(null);
    }
    if (!response.ok) {
        const payload = await response.json().catch(()=>null);
        throw new ApiError(response.status, payload?.error ?? {
            code: "REQUEST_FAILED",
            message: "The request could not be completed"
        });
    }
    return response.blob();
}
const newIdempotencyKey = ()=>typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-smartretail`;
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=apps_web_17fxonn._.js.map