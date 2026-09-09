import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  CreditCard,
  Loader2,
  MapPin,
  ShieldCheck,
  Lock,
  Smartphone,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

import { useCart, cartSubtotal } from "@/lib/cart-store";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice } from "@/lib/format";
import { calculateShippingCost, checkAddressServiceability } from "@/lib/shipping";
import { placeOrder } from "@/lib/orders.functions";
import { createRazorpayOrder, getPaymentConfig } from "@/lib/razorpay.functions";
import { StorePoliciesNotice } from "@/components/shop/StorePoliciesNotice";

const ShippingSchema = z.object({
  full_name: z.string().min(2, "Required"),
  email: z.string().email("Invalid email"),
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Please enter a valid 10-digit phone number"),
  line1: z.string().min(2, "Required"),
  line2: z.string().optional(),
  city: z.string().min(2, "Required"),
  state: z.string().min(2, "Required"),
  postal_code: z.string().min(3, "Required"),
  country: z.string().min(2, "Required"),
});
type Shipping = z.infer<typeof ShippingSchema>;

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Weekdayzz" },
      { name: "description", content: "Secure checkout. Free shipping above ₹2,000." },
    ],
  }),
  component: Checkout,
});

function Checkout() {
  const { items, clear } = useCart();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      toast.error("Please sign in to access checkout");
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);

  const placeOrderFn = useServerFn(placeOrder);
  const createRazorpayOrderFn = useServerFn(createRazorpayOrder);
  const getPaymentConfigFn = useServerFn(getPaymentConfig);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [shipping, setShipping] = useState<Shipping | null>(null);
  const [loading, setLoading] = useState(false);

  // Preload Razorpay SDK as soon as user reaches step 2 (order review),
  // so the script is already cached when they click Pay
  useEffect(() => {
    if (step >= 2 && typeof window !== "undefined" && !(window as any).Razorpay) {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, [step]);

  const subtotal = cartSubtotal(items);
  const shippingCost = shipping ? calculateShippingCost(shipping) : 9900;
  const freeShip = true;
  const total = subtotal + (freeShip ? 0 : shippingCost);

  const form = useForm<Shipping>({
    resolver: zodResolver(ShippingSchema),
    defaultValues: { country: "IN", email: user?.email ?? "" },
  });

  const checkServiceabilityFn = useServerFn(checkAddressServiceability);
  const [checkingServiceability, setCheckingServiceability] = useState(false);
  const [locating, setLocating] = useState(false);

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
          );
          if (!res.ok) throw new Error("Failed to get address");
          const data = await res.json();
          const addr = data.address;

          if (addr) {
            const streetParts = [
              addr.house_number,
              addr.road,
              addr.suburb || addr.neighbourhood,
            ].filter(Boolean);
            const line1 = streetParts.join(", ") || addr.amenity || "";

            const city = addr.city || addr.town || addr.village || addr.municipality || "";
            const state = addr.state || "";
            const postcode = addr.postcode || "";
            const country = (addr.country_code || "IN").toUpperCase();

            form.setValue("line1", line1, { shouldValidate: true });
            form.setValue("city", city, { shouldValidate: true });
            form.setValue("state", state, { shouldValidate: true });
            form.setValue("postal_code", postcode, { shouldValidate: true });
            form.setValue("country", country, { shouldValidate: true });

            if (postcode) {
              const result = await checkServiceabilityFn({
                data: { postal_code: postcode, country },
              });
              if (!result.valid) {
                form.setError("postal_code", {
                  type: "manual",
                  message: result.error || "Invalid pincode",
                });
              } else if (!result.serviceable) {
                form.setError("postal_code", {
                  type: "manual",
                  message: result.error || "Not serviceable",
                });
              } else {
                form.clearErrors("postal_code");
                toast.success("Address and serviceability details populated!");
                return;
              }
            }
            toast.success("Location added successfully!");
          } else {
            toast.error("Could not determine address details");
          }
        } catch (error) {
          console.error("Reverse geocoding error:", error);
          toast.error("Failed to retrieve address details");
        } finally {
          setLocating(false);
        }
      },
      (error) => {
        console.error("Geolocation error:", error);
        if (!window.isSecureContext) {
          toast.error(
            "Geolocation requires a secure connection (HTTPS). On mobile, please connect via HTTPS/tunnel or enter the address manually.",
          );
        } else if (error.code === 1) {
          toast.error(
            "Location permission denied. Please allow location access in your browser settings.",
          );
        } else if (error.code === 2) {
          toast.error("Location unavailable. Please check if device GPS/Location is enabled.");
        } else if (error.code === 3) {
          toast.error("Location request timed out. Please try again.");
        } else {
          toast.error("Failed to access your location. Please check browser permissions.");
        }
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleShippingSubmit = async (data: Shipping) => {
    setCheckingServiceability(true);
    try {
      const result = await checkServiceabilityFn({
        data: {
          postal_code: data.postal_code,
          country: data.country,
        },
      });

      if (!result.valid) {
        form.setError("postal_code", {
          type: "manual",
          message: result.error || "Invalid postal code.",
        });
        toast.error(result.error || "Invalid postal code.");
        return;
      }

      if (!result.serviceable) {
        form.setError("postal_code", {
          type: "manual",
          message: result.error || "This location is not serviceable.",
        });
        toast.error(result.error || "This location is not serviceable.");
        return;
      }

      if (result.city && !form.getValues("city")) {
        form.setValue("city", result.city);
        data.city = result.city;
      }
      if (result.state && !form.getValues("state")) {
        form.setValue("state", result.state);
        data.state = result.state;
      }
      if (result.area && !form.getValues("line2")) {
        form.setValue("line2", result.area);
        data.line2 = result.area;
      }

      setShipping(data);
      setStep(2);
    } catch (e) {
      console.error(e);
      toast.error("Failed to verify address serviceability. Please try again.");
    } finally {
      setCheckingServiceability(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-display text-4xl">Nothing to check out.</h1>
        <Link
          to="/shop"
          className="inline-block mt-6 bg-accent text-accent-foreground px-6 py-3 text-sm uppercase tracking-widest font-semibold"
        >
          Shop
        </Link>
      </div>
    );
  }

  useEffect(() => {
    if (!loading) return;
    const handleFocus = () => {
      // Safety guard for iOS: Reset loading state if tab regains focus after app switch
      const timer = setTimeout(() => {
        setLoading(false);
      }, 2000);
      return () => clearTimeout(timer);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loading]);

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (typeof window !== "undefined" && (window as any).Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  async function pay(preferredMethod?: "upi" | "card" | "netbanking") {
    if (!user) {
      toast.error("Sign in to complete your order");
      navigate({ to: "/auth" });
      return;
    }
    if (!shipping) return;
    setLoading(true);

    try {
      // Run all three in parallel: load SDK + create order + fetch key_id
      const [isLoaded, order, { keyId: razorpayKey }] = await Promise.all([
        loadRazorpayScript(),
        createRazorpayOrderFn({ data: { amount_cents: total } }),
        getPaymentConfigFn(),
      ]);

      if (!isLoaded) {
        toast.error("Failed to load Razorpay SDK. Check your internet connection.");
        setLoading(false);
        return;
      }

      if (!razorpayKey) {
        toast.error("Payment is temporarily unavailable. Please try again.");
        setLoading(false);
        return;
      }

      const options: any = {
        key: razorpayKey,
        amount: order.amount,
        currency: order.currency,
        name: "Weekdayzz",
        description: "Streetwear & Custom Drops",
        order_id: order.id,
        handler: async function (response: any) {
          setLoading(true);
          try {
            const { id } = await placeOrderFn({
              data: {
                items: items.map((i) => ({
                  product_id: i.product_id ?? null,
                  custom_design_id: i.custom_design_id ?? null,
                  quantity: i.quantity,
                  size: i.size,
                  color: i.color ?? null,
                  unit_price_cents: i.unit_price_cents,
                  title_snapshot: i.title,
                  image_snapshot: i.image,
                })),
                total_cents: total,
                shipping_details: shipping,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
            });
            clear();
            toast.success("Payment successful!");
            navigate({ to: "/account", search: { order: id } as never });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Order failed");
          } finally {
            setLoading(false);
          }
        },
        prefill: {
          name: shipping.full_name,
          email: shipping.email,
          contact: shipping.phone,
          method: preferredMethod,
        },
        theme: {
          color: "#0A0A0A",
        },
        modal: {
          ondismiss: () => {
            setLoading(false);
          },
          handleback: true,
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on("payment.failed", function (resp: any) {
        console.error("Razorpay payment failed:", resp.error);
        toast.error(resp.error?.description || "Payment was not completed.");
        setLoading(false);
      });
      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment initialization failed");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
      <h1 className="text-display text-5xl mb-2">CHECKOUT</h1>

      <div className="flex items-center gap-3 mb-10 text-xs uppercase tracking-widest">
        {(["Shipping", "Review", "Payment"] as const).map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const active = step === n;
          const done = step > n;
          const isClickable = n < step || (n === 2 && shipping !== null);
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (isClickable) setStep(n);
              }}
              disabled={!isClickable && !active}
              className={`flex items-center gap-2 ${active ? "text-accent font-semibold" : done ? "text-foreground hover:text-accent cursor-pointer font-semibold" : "text-muted-foreground cursor-not-allowed"}`}
            >
              <div
                className={`w-7 h-7 grid place-items-center border ${active ? "border-accent bg-accent text-accent-foreground" : done ? "border-foreground bg-foreground text-background" : "border-border"}`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </div>
              {label}
              {n < 3 && <span className="w-8 h-px bg-border" />}
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-10">
        <div>
          {step === 1 && (
            <form onSubmit={form.handleSubmit(handleShippingSubmit)} className="space-y-6">
              <div className="flex justify-between items-center pb-2 border-b border-border">
                <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                  Contact & Shipping
                </h2>
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={locating}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors uppercase tracking-widest font-semibold disabled:opacity-50"
                >
                  {locating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MapPin className="h-3.5 w-3.5" />
                  )}
                  {locating ? "Locating..." : "Use Current Location"}
                </button>
              </div>

              <div className="space-y-4">
                {/* Full name */}
                <div>
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">
                    Full name
                  </label>
                  <input
                    {...form.register("full_name")}
                    className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                    placeholder="Your name"
                  />
                  {form.formState.errors.full_name && (
                    <p className="text-xs text-destructive mt-1">
                      {form.formState.errors.full_name.message}
                    </p>
                  )}
                </div>

                {/* Email and Phone Grid */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Email
                    </label>
                    <input
                      {...form.register("email")}
                      className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                      placeholder="your-email@example.com"
                    />
                    {form.formState.errors.email && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.email.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Phone
                    </label>
                    <input
                      {...form.register("phone")}
                      type="tel"
                      maxLength={10}
                      className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                      placeholder="9876543210"
                    />
                    {form.formState.errors.phone && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.phone.message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Address Lines */}
                <div>
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">
                    Address line 1
                  </label>
                  <input
                    {...form.register("line1")}
                    className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                    placeholder="House number, Street name, Apartment"
                  />
                  {form.formState.errors.line1 && (
                    <p className="text-xs text-destructive mt-1">
                      {form.formState.errors.line1.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">
                    Address line 2 (optional)
                  </label>
                  <input
                    {...form.register("line2")}
                    className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                    placeholder="Landmark, Area, Suite"
                  />
                  {form.formState.errors.line2 && (
                    <p className="text-xs text-destructive mt-1">
                      {form.formState.errors.line2.message}
                    </p>
                  )}
                </div>

                {/* City, State, Pincode Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="col-span-1">
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Postal code
                    </label>
                    <input
                      {...form.register("postal_code", {
                        onBlur: async (e) => {
                          const val = e.target.value;
                          const country = form.getValues("country") || "IN";
                          if (val && val.length >= 3) {
                            try {
                              const res = await checkServiceabilityFn({
                                data: { postal_code: val, country },
                              });
                              if (!res.valid) {
                                form.setError("postal_code", {
                                  type: "manual",
                                  message: res.error || "Invalid pincode",
                                });
                              } else if (!res.serviceable) {
                                form.setError("postal_code", {
                                  type: "manual",
                                  message: res.error || "Not serviceable",
                                });
                              } else {
                                form.clearErrors("postal_code");
                                if (res.city && !form.getValues("city")) {
                                  form.setValue("city", res.city, { shouldValidate: true });
                                }
                                if (res.state && !form.getValues("state")) {
                                  form.setValue("state", res.state, { shouldValidate: true });
                                }
                                if (res.area && !form.getValues("line2")) {
                                  form.setValue("line2", res.area, { shouldValidate: true });
                                }
                              }
                            } catch (err) {
                              console.error(err);
                            }
                          }
                        },
                      })}
                      className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                      placeholder="560001"
                    />
                    {form.formState.errors.postal_code && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.postal_code.message}
                      </p>
                    )}
                  </div>

                  <div className="col-span-1">
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      City
                    </label>
                    <input
                      {...form.register("city")}
                      className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                      placeholder="Bengaluru"
                    />
                    {form.formState.errors.city && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.city.message}
                      </p>
                    )}
                  </div>

                  <div className="col-span-1">
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      State / Region
                    </label>
                    <input
                      {...form.register("state")}
                      className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                      placeholder="Karnataka"
                    />
                    {form.formState.errors.state && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.state.message}
                      </p>
                    )}
                  </div>

                  <div className="col-span-1">
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Country
                    </label>
                    <input
                      {...form.register("country")}
                      className="mt-1 w-full bg-card border border-border px-3 py-3 text-sm focus:outline-none focus:border-accent"
                      placeholder="IN"
                    />
                    {form.formState.errors.country && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.country.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={checkingServiceability}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground px-6 py-4 text-sm uppercase tracking-widest font-semibold disabled:opacity-50 hover:bg-accent/90 transition-colors"
              >
                {checkingServiceability ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying serviceability...
                  </>
                ) : (
                  "Continue to review"
                )}
              </button>
            </form>
          )}

          {step === 2 && shipping && (
            <div className="space-y-6">
              <div className="bg-card border border-border p-5 text-sm space-y-1">
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
                  Shipping to
                </h3>
                <p className="font-semibold text-foreground">{shipping.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  Phone: {shipping.phone} · {shipping.email}
                </p>
                <p className="pt-1">
                  {shipping.line1}
                  {shipping.line2 ? `, ${shipping.line2}` : ""}
                </p>
                <p>
                  {shipping.city}, {shipping.state} {shipping.postal_code}
                </p>
                <p>{shipping.country}</p>
                <button
                  onClick={() => setStep(1)}
                  className="text-xs text-accent uppercase tracking-widest pt-2 font-semibold hover:underline block"
                >
                  Edit Details
                </button>
              </div>
              <ul className="divide-y divide-border border border-border">
                {items.map((i) => (
                  <li key={i.key} className="p-4 flex gap-3 items-center">
                    <div className="w-12 h-14 bg-muted overflow-hidden">
                      <img src={i.image} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 text-sm">
                      <p className="font-semibold">{i.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Size {i.size}
                        {i.color ? ` · ${i.color}` : ""} · Qty {i.quantity}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatPrice(i.unit_price_cents * i.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center gap-2 border border-border bg-card hover:bg-muted text-foreground px-6 py-4 text-sm uppercase tracking-widest font-semibold transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to Shipping
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="bg-accent text-accent-foreground px-6 py-4 text-sm uppercase tracking-widest font-semibold hover:bg-accent/90 transition-colors"
                >
                  Continue to payment
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              {/* Official Store Policies Table */}
              <StorePoliciesNotice />

              <div className="bg-card border border-border p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-accent" />
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wider">
                        Razorpay Secure Checkout
                      </h3>
                      <p className="text-xs text-muted-foreground">100% Prepaid Only · Encrypted & Safe Payment</p>
                    </div>
                  </div>
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  Select your preferred payment method to launch{" "}
                  <strong className="text-foreground">Razorpay</strong> directly for{" "}
                  <strong className="text-foreground">Pay {formatPrice(total)}</strong>:
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => pay("upi")}
                    disabled={loading}
                    className="border border-border bg-background hover:bg-muted hover:border-accent p-4 flex flex-col items-center justify-center gap-1.5 text-center transition-all group cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                  >
                    <Smartphone className="h-5 w-5 text-accent group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold">UPI / QR</span>
                    <span className="text-[10px] text-muted-foreground">GPay, PhonePe, Paytm</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => pay("card")}
                    disabled={loading}
                    className="border border-border bg-background hover:bg-muted hover:border-accent p-4 flex flex-col items-center justify-center gap-1.5 text-center transition-all group cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                  >
                    <CreditCard className="h-5 w-5 text-accent group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold">Cards</span>
                    <span className="text-[10px] text-muted-foreground">
                      Visa, Mastercard, RuPay
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => pay("netbanking")}
                    disabled={loading}
                    className="border border-border bg-background hover:bg-muted hover:border-accent p-4 flex flex-col items-center justify-center gap-1.5 text-center transition-all group cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 col-span-2 sm:col-span-1"
                  >
                    <ShieldCheck className="h-5 w-5 text-accent group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold">NetBanking & Wallets</span>
                    <span className="text-[10px] text-muted-foreground">All Major Banks</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 border border-border bg-card hover:bg-muted text-foreground px-6 py-5 text-sm uppercase tracking-widest font-semibold disabled:opacity-50 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to Review
                </button>
                <button
                  onClick={() => pay()}
                  disabled={loading}
                  className="flex-1 min-w-[240px] inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground px-6 py-5 text-sm uppercase tracking-widest font-semibold disabled:opacity-50 hover:bg-accent/90 transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Processing order...
                    </>
                  ) : (
                    <>Pay {formatPrice(total)} with Razorpay</>
                  )}
                </button>
              </div>

              {!user && (
                <p className="text-xs text-center text-muted-foreground">
                  <Link to="/auth" className="text-accent underline">
                    Sign in
                  </Link>{" "}
                  to complete your order.
                </p>
              )}
            </div>
          )}
        </div>

        <aside className="bg-card border border-border p-6 h-fit lg:sticky lg:top-24 space-y-3 text-sm">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Order summary</h3>
          <div className="flex justify-between">
            <span>Items</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Shipping</span>
            <span>
              {freeShip ? <span className="text-accent">FREE</span> : formatPrice(shippingCost)}
            </span>
          </div>
          <div className="border-t border-border pt-3 flex justify-between text-base font-semibold">
            <span>Total</span>
            <span>{formatPrice(total)}</span>
          </div>
          <StorePoliciesNotice variant="compact" />
        </aside>
      </div>
    </div>
  );
}
