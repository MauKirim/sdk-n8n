# n8n-nodes-maukirim

The official n8n community node for **[MauKirim](https://maukirim.com)** — the managed WhatsApp
gateway for OTP codes, templated notifications, and rented WhatsApp numbers.

- Website: <https://maukirim.com>
- Dashboard & API: <https://app.maukirim.com>
- API base URL: `https://app.maukirim.com/api/v1`

This node wraps the MauKirim REST API: one node, four resources, every documented operation.
No WhatsApp session to babysit, no provider prose in errors — just MauKirim's documented codes.

## Installation

### Inside n8n (community nodes)

1. Open n8n and go to **Settings → Community nodes**.
2. Choose **Install a community node**.
3. Enter `n8n-nodes-maukirim` and confirm.

Community nodes must be enabled on your instance. On n8n Cloud only verified community nodes can be
installed; on self-hosted n8n any community node can be installed from that same screen.

### With npm (self-hosted, manual)

```bash
npm i n8n-nodes-maukirim
```

Install it into the n8n installation directory (the folder that holds n8n's own `node_modules`), or
into `~/.n8n/custom`, then restart n8n.

## Credentials

Create an API key in your [MauKirim dashboard](https://app.maukirim.com) — the value is shown exactly
once and starts with `mk_live_`. Then, in n8n:

1. Create a credential of type **MauKirim API**.
2. Paste the key into **API Key** — it is sent as `Authorization: Bearer mk_live_…`.
3. Leave **Base URL** at `https://app.maukirim.com/api/v1` unless you target another deployment.

Click **Test**: the credential is verified with `GET /devices`, so the key used for the test needs the
`read` scope. Keys are scoped per route — see the MauKirim documentation for the scope each operation
needs (`otp`, `notification`, `read`, `device`, `send`, `webhook`).

## Operations

| Resource | Operation | Endpoint | Fields |
| --- | --- | --- | --- |
| OTP | Send | `POST /otp/send` | Phone Number, Purpose, Idempotency Key |
| OTP | Verify | `POST /otp/verify` | Challenge ID, Code |
| Notification | Send | `POST /messages/send` | Phone Number, Template ID, Variables (JSON), Attachment Upload ID, Idempotency Key |
| Device | List | `GET /devices` | — |
| Device | Get | `GET /devices/{id}` | Device ID |
| Device | Send Message | `POST /devices/{id}/messages` | Device ID, Phone Number, Message, Idempotency Key |
| Device | Set Presence | `POST /devices/{id}/presence` | Device ID, Presence |
| Webhook | Get | `GET /devices/{id}/webhook` | Device ID |
| Webhook | Set | `POST /devices/{id}/webhook` | Device ID, URL, Events, Active |
| Webhook | Remove | `DELETE /devices/{id}/webhook` | Device ID |
| Webhook | List Deliveries | `GET /webhook-deliveries` | Device ID (optional), Limit, Offset |

Each item returns the raw MauKirim success envelope as JSON, e.g. `{"ok":true,"challengeId":"…","batchId":"…","expiresAt":"…"}`.

### Idempotency

The three routes that charge or send — `POST /otp/send`, `POST /messages/send`,
`POST /devices/{id}/messages` — require an **Idempotency Key** of 1–128 characters. Repeating a key
with the same normalized request replays the original result instead of sending (and charging) twice.
Reusing a key with a *different* request fails with `409 batch_idempotency_conflict`.

Retryable failures (`503 worker_offline`, timeouts, `502`, and `500 server_error` once) should be
retried **with the same key**.

### Errors

A failed call raises a node error carrying the API code, e.g.:

```
MauKirim API error: insufficient_credits
The account balance is below the cost of this message. Top up, then retry.
```

Codes such as `api_key_scope_denied`, `invalid_input`, `rate_limited`, `insufficient_credits`,
`device_not_connected`, `worker_offline`, `media_unavailable` and `webhook_not_configured` are mapped
to a short explanation. `POST /otp/verify` answers `200` with `verified: false` for a wrong, expired,
used, or out-of-attempts code — that is a successful node run, not an error.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # jest (no network: the HTTP layer is injected)
```

The HTTP layer lives in `nodes/MauKirim/transport.ts` and takes the request function as an argument,
so both unit suites run entirely offline.

## Publishing

This package follows the n8n community-node conventions: the npm name **must** start with
`n8n-nodes-` (the `n8n-nodes-maukirim` name is what makes it installable and eligible for
verification), and `package.json` declares the `n8n-community-node-package` keyword plus the `n8n`
section pointing at the built credential and node files.

To release a new version:

```bash
npm install
npm run build            # dist/ must be built before publishing; "files": ["dist"] ships it
npm test
npm version patch        # or minor / major
npm publish --access public
```

Then submit the package to the n8n community-node catalogue so it becomes discoverable and
verifiable:

1. Push the release to the [n8n Creator hub](https://n8n.io/creators/) / submit the package for
   review as described in the n8n docs ("Submit community nodes").
2. The reviewer installs the published package and checks the `n8n` manifest paths, the
   `n8n-nodes-` prefix, and that `n8n-workflow` is a peer dependency.

No build step is needed by consumers — npm ships the compiled `dist/` directory.

## License

[MIT](LICENSE) © MauKirim
