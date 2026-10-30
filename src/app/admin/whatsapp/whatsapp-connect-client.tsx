"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, Card, ErrorBanner, Notice, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { usePolling } from "@/lib/client/use-polling";

interface SyncDto {
  requestedAt: string | null;
  error: string | null;
}

interface ConnectionDto {
  businessAccountId: string;
  phoneNumberId: string;
  connectedAt: string;
  /** Meta allows the one-time history import until then. */
  syncDeadline: string;
  subscribed: boolean;
  contactsSync: SyncDto;
  historySync: SyncDto;
}

interface StatusResponse {
  signup: { enabled: true; appId: string; configId: string; apiVersion: string } | { enabled: false; reason: string };
  active: { phoneNumberId: string; businessAccountId: string } | null;
  connection: ConnectionDto | null;
}

/** The parts of the Facebook JavaScript SDK this page uses. */
interface FacebookSdk {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: { config_id: string; response_type: "code"; override_default_response_type: true; extras: Record<string, unknown> },
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const FACEBOOK_ORIGINS = new Set(["https://www.facebook.com", "https://web.facebook.com"]);

function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error("Facebook SDK did not load"));
        return;
      }
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("Could not load the Facebook SDK. Check the browser's ad or tracking blocker."));
    document.body.appendChild(script);
  });
}

function SyncLine({ label, sync }: { label: string; sync: SyncDto }) {
  return (
    <p className="text-sm">
      {label}:{" "}
      {sync.error ? <span className="text-red-600">failed ({sync.error})</span> : sync.requestedAt ? `requested ${formatDateTime(sync.requestedAt)}` : "not requested"}
    </p>
  );
}

export function WhatsAppConnectClient() {
  const statusQuery = usePolling<StatusResponse>("/api/admin/whatsapp/coexistence", 60_000);
  const status = statusQuery.data;
  const load = statusQuery.refresh;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? statusQuery.error;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // Embedded Signup reports the code (login callback) and the account IDs (window message) separately.
  const code = useRef<string | null>(null);
  const ids = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);

  const finish = useCallback(async () => {
    if (!code.current || !ids.current) return;
    const body = { code: code.current, ...ids.current };
    code.current = null;
    ids.current = null;
    setProgress("Connecting the account…");
    try {
      await api("/api/admin/whatsapp/coexistence", { method: "POST", body });
      setProgress(null);
      await load();
    } catch (caught) {
      setProgress(null);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!FACEBOOK_ORIGINS.has(event.origin) || typeof event.data !== "string") return;
      let message: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string; current_step?: string; error_message?: string } };
      try {
        message = JSON.parse(event.data) as typeof message;
      } catch {
        return;
      }
      if (message.type !== "WA_EMBEDDED_SIGNUP") return;
      if (message.event?.startsWith("FINISH") && message.data?.waba_id && message.data.phone_number_id) {
        ids.current = { wabaId: message.data.waba_id, phoneNumberId: message.data.phone_number_id };
        void finish();
      } else if (message.event === "CANCEL") {
        setBusy(false);
        setError(message.data?.error_message ?? `The connection was cancelled${message.data?.current_step ? ` at step ${message.data.current_step}` : ""}.`);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [finish]);

  async function connect() {
    if (!status?.signup.enabled) return;
    setError(null);
    setBusy(true);
    try {
      const sdk = await loadSdk(status.signup.appId, status.signup.apiVersion);
      sdk.login(
        (response) => {
          if (!response.authResponse?.code) {
            setBusy(false);
            setError("The connection was not completed.");
            return;
          }
          code.current = response.authResponse.code;
          void finish();
        },
        {
          config_id: status.signup.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
        },
      );
    } catch (caught) {
      setBusy(false);
      setError(errorMessage(caught));
    }
  }

  const connection = status?.connection ?? null;
  const active = status?.active ?? null;
  const idsMatch = connection && active && connection.phoneNumberId === active.phoneNumberId && connection.businessAccountId === active.businessAccountId;
  // The server enforces Meta's 24-hour limit and explains when it has passed.
  const canStartSync = Boolean(idsMatch && !connection.historySync.requestedAt);

  async function startSync() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/whatsapp/coexistence", { method: "PUT" });
      setProgress("Chat history import started. Keep the WhatsApp Business app open on the phone while it syncs.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="WhatsApp connection"
        description="Connect the number already used in the WhatsApp Business app. Staff keep using the app on the phone and the bot answers on the same number (coexistence)."
      />
      <ErrorBanner message={error} />
      {progress ? <Notice tone="blue">{progress}</Notice> : null}

      <Card>
        <h2 className="font-semibold">Before you connect</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
          <li>The phone has the WhatsApp Business app, version 2.24.17 or newer, with this number.</li>
          <li>Keep the phone nearby: WhatsApp shows a code there that is entered in the popup.</li>
          <li>Keep the app open afterwards while the chat history syncs (it can take a few hours).</li>
          <li>Turn off the app&apos;s greeting and away messages if the bot sends the greeting, so customers do not get two.</li>
          <li>Linked devices such as WhatsApp Web are signed out during the connection.</li>
        </ul>
      </Card>

      <Card>
        {!status ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !status.signup.enabled ? (
          <Notice>
            Embedded Signup is not set up on the server yet ({status.signup.reason}). Add META_APP_ID and META_EMBEDDED_SIGNUP_CONFIG_ID, see docs/deployment.md.
          </Notice>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy} onClick={() => void connect()}>
              {busy ? "Waiting for Facebook…" : connection ? "Connect again" : "Connect WhatsApp Business app"}
            </Button>
            <p className="text-xs text-slate-500">A Facebook window opens. Allow popups for this site if nothing appears.</p>
          </div>
        )}
      </Card>

      {connection ? (
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="font-semibold">Last connection</h2>
            {idsMatch ? <Badge tone="green">Active</Badge> : <Badge tone="yellow">Not active yet</Badge>}
          </div>
          <p className="text-sm">Connected {formatDateTime(connection.connectedAt)}</p>
          <p className="text-sm">Webhooks subscribed: {connection.subscribed ? "yes" : <span className="text-red-600">no</span>}</p>
          <SyncLine label="Contacts sync" sync={connection.contactsSync} />
          <SyncLine label="Chat history sync" sync={connection.historySync} />
          {canStartSync ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button disabled={busy} onClick={() => void startSync()}>
                Start chat history import
              </Button>
              <p className="text-xs text-slate-500">Imports contacts and up to 6 months of chats once. Available until {formatDateTime(connection.syncDeadline)}.</p>
            </div>
          ) : null}
          {!idsMatch && !connection.historySync.requestedAt ? (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
              The chat history import starts after the server uses this number (below). Do it before {formatDateTime(connection.syncDeadline)}.
            </p>
          ) : null}
          {!idsMatch ? (
            <div className="mt-3 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">
              <p className="mb-2">Set these on the server and restart the app so the bot uses this number:</p>
              <pre className="overflow-x-auto text-xs">
                {`WHATSAPP_PHONE_NUMBER_ID=${connection.phoneNumberId}\nWHATSAPP_BUSINESS_ACCOUNT_ID=${connection.businessAccountId}`}
              </pre>
              <p className="mt-2 text-xs text-slate-500">WHATSAPP_ACCESS_TOKEN must be a system user token with access to this WhatsApp account.</p>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
