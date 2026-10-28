"use client";

import { useState, type SubmitEvent } from "react";

import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { usePolling } from "@/lib/client/use-polling";
import type { KnowledgeProduct } from "@/services/chatbot/types";
import type { ProductDto, SettingsDto } from "@/services/dto";
import type { WebsiteSyncReport } from "@/services/knowledge/website-sync";

interface Draft {
  id: string | null;
  kind: ProductDto["kind"];
  name: string;
  description: string;
  price: string;
  currency: string;
  availability: ProductDto["availability"];
  keywords: string;
  offerPrice: string;
  offerUntil: string;
  offerNote: string;
  active: boolean;
}

const EMPTY: Draft = { id: null, kind: "product", name: "", description: "", price: "", currency: "AED", availability: "available", keywords: "", offerPrice: "", offerUntil: "", offerNote: "", active: true };

const AVAILABILITY_LABEL: Record<ProductDto["availability"], string> = {
  available: "Available",
  out_of_stock: "Out of stock",
  on_request: "On request",
  discontinued: "Discontinued",
};

export function ProductsClient() {
  const { data, error, refresh } = usePolling<{ items: ProductDto[]; website: { error: boolean; items: KnowledgeProduct[] } | null }>("/api/admin/products", 60_000);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncUrl, setSyncUrl] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<WebsiteSyncReport | null>(null);

  async function openSync() {
    setActionError(null);
    setSyncReport(null);
    try {
      const { settings } = await api<{ settings: SettingsDto }>("/api/admin/settings");
      setSyncUrl(settings.websiteUrl ? `${settings.websiteUrl.replace(/\/+$/, "")}/menu` : "");
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function sync(event: SubmitEvent) {
    event.preventDefault();
    if (syncUrl === null) return;
    setActionError(null);
    setSyncing(true);
    try {
      const { report } = await api<{ report: WebsiteSyncReport }>("/api/admin/products/sync", { method: "POST", body: { url: syncUrl } });
      setSyncReport(report);
      setSyncUrl(null);
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!draft) return;
    setActionError(null);
    const price = draft.price.trim() === "" ? null : Number(draft.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setActionError("Price must be a positive number, or empty if not published.");
      return;
    }
    const offerPrice = draft.offerPrice.trim() === "" ? null : Number(draft.offerPrice);
    if (offerPrice !== null && (!Number.isFinite(offerPrice) || offerPrice < 0 || !draft.offerUntil)) {
      setActionError("An offer needs a positive price and a last day.");
      return;
    }
    const body = {
      kind: draft.kind,
      name: draft.name,
      description: draft.description,
      price,
      currency: draft.currency,
      availability: draft.availability,
      keywords: draft.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
      offer: offerPrice === null ? null : { price: offerPrice, validUntil: draft.offerUntil, note: draft.offerNote },
      active: draft.active,
    };
    try {
      await api(draft.id ? `/api/admin/products/${draft.id}` : "/api/admin/products", { method: draft.id ? "PATCH" : "POST", body });
      setDraft(null);
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function remove(product: ProductDto) {
    if (!window.confirm(`Delete "${product.name}"?`)) return;
    try {
      await api(`/api/admin/products/${product.id}`, { method: "DELETE" });
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  return (
    <div>
      <PageHeader
        title="Products & services"
        description="Verified information the bot may share. It never quotes a price that is not listed here."
        actions={
          <>
            <Button variant="secondary" onClick={() => void openSync()}>
              Sync from website
            </Button>
            <Button onClick={() => setDraft(EMPTY)}>Add item</Button>
          </>
        }
      />
      <ErrorBanner message={error ?? actionError} />

      {syncUrl !== null ? (
        <Card className="mb-4">
          <form onSubmit={(event) => void sync(event)} className="grid gap-3">
            <Field label="Menu or products page" hint="A page on the website saved in Settings. Prices, names and descriptions are copied from it; run the sync again after changing the website.">
              <Input type="url" required placeholder="https://example.com/menu" value={syncUrl} onChange={(event) => setSyncUrl(event.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={syncing}>
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button variant="secondary" onClick={() => setSyncUrl(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {syncReport ? (
        <Card className="mb-4 text-sm">
          Found {syncReport.found} items on the website: {syncReport.created} added, {syncReport.updated} updated
          {syncReport.deactivated > 0 ? `, ${syncReport.deactivated} no longer listed (set inactive)` : ""}.
        </Card>
      ) : null}

      {draft ? (
        <Card className="mb-4">
          <form onSubmit={(event) => void save(event)} className="grid gap-3 md:grid-cols-2">
            <Field label="Name">
              <Input required maxLength={150} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Draft["kind"] })}>
                <option value="product">Product</option>
                <option value="service">Service</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Description">
                <Textarea maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </Field>
            </div>
            <Field label="Price" hint="Leave empty if the price is not published">
              <Input inputMode="decimal" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
            </Field>
            <Field label="Currency">
              <Input maxLength={3} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="Availability">
              <Select value={draft.availability} onChange={(event) => setDraft({ ...draft, availability: event.target.value as Draft["availability"] })}>
                {Object.entries(AVAILABILITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Keywords" hint="Comma separated other names customers use">
              <Input value={draft.keywords} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} />
            </Field>
            <Field label="Offer price" hint="Optional special price. Leave empty for no offer.">
              <Input inputMode="decimal" value={draft.offerPrice} onChange={(event) => setDraft({ ...draft, offerPrice: event.target.value })} />
            </Field>
            <Field label="Offer valid until" hint="Last day of the offer; the bot stops mentioning it afterwards">
              <Input type="date" value={draft.offerUntil} onChange={(event) => setDraft({ ...draft, offerUntil: event.target.value })} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Offer note" hint="Optional, e.g. Weekend special">
                <Input maxLength={200} value={draft.offerNote} onChange={(event) => setDraft({ ...draft, offerNote: event.target.value })} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Checkbox label="Active (used by the bot)" checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit">{draft.id ? "Save changes" : "Create item"}</Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {data?.website ? (
        <Card className="mb-4 overflow-x-auto p-0">
          <div className="border-b border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
            {data.website.error ? (
              <span className="text-red-600">The website database could not be reached. The bot is using the items below until it is back.</span>
            ) : (
              <>
                <span className="font-medium">Live from the website database ({data.website.items.length} items).</span>{" "}
                <span className="text-slate-500">Change these in the website admin; the bot sees changes within a minute. Items marked “from website” below are only a backup copy.</span>
              </>
            )}
          </div>
          {data.website.items.length > 0 ? (
            <table className="w-full min-w-[640px] text-left text-sm">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.website.items.map((product) => (
                  <tr key={product.id}>
                    <td className="px-4 py-2 font-medium">{product.name}</td>
                    <td className="px-4 py-2">
                      {product.price === null ? <span className="text-slate-500">Not published</span> : `${product.price} ${product.currency}`}
                      {product.offer ? (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">
                          Offer {product.offer.price} {product.currency} until {product.offer.validUntil}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">{AVAILABILITY_LABEL[product.availability]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      ) : null}

      {data && data.items.length === 0 && !data.website?.items.length ? <EmptyState title="No products or services yet" /> : null}
      {data && data.items.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Availability</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.items.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs capitalize text-slate-500">
                      {product.kind}
                      {product.source === "website" ? " · from website" : ""}
                    </p>
                  </td>
                  <td className="px-4 py-2">{product.price === null ? <span className="text-slate-500">Not published</span> : `${product.price} ${product.currency}`}
                    {product.offer ? (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        Offer {product.offer.price} {product.currency} until {product.offer.validUntil}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">{AVAILABILITY_LABEL[product.availability]}</td>
                  <td className="px-4 py-2">{product.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setDraft({
                          id: product.id,
                          kind: product.kind,
                          name: product.name,
                          description: product.description,
                          price: product.price === null ? "" : String(product.price),
                          currency: product.currency,
                          availability: product.availability,
                          keywords: product.keywords.join(", "),
                          offerPrice: product.offer ? String(product.offer.price) : "",
                          offerUntil: product.offer?.validUntil ?? "",
                          offerNote: product.offer?.note ?? "",
                          active: product.active,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" className="text-red-600" onClick={() => void remove(product)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
