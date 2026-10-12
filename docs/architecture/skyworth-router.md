# Skyworth GN630V integration preparation

Status: offline device-response reader implemented. No live polling, saved credentials,
dashboard integration or router mutations are implemented.

The administrator confirmed DeskPilot runs on the router's LAN. User-supplied GN630V
V1.0.0.1 responses establish the following page formats; they are not a supported API
contract and must be revalidated after firmware changes.

- `/cgi-bin/sta-user.asp`: `result_lan` and `result_Wifi` contain JSON arrays.
  Names, IPv4/MAC addresses, port/band, router status and connection time can be read.
- `/cgi-bin/sec-macfilter.asp`: enabled flag, Black/White policy and JSON rule table.
- `/cgi-bin/sec-addmacfilter.asp`: POST form with Name, SourceMACAddress,
  Save_Flag=1, EnableMac_Flag=Yes, RuleType_Flag=MAC, Direction_Flag=Incoming,
  IpMacType_Flag=Mac, Actionflag=Add and Interface_Flag=br0. Current counters and
  other form fields must come from fresh authenticated responses, not guessed values.
- `/cgi-bin/sec-urlfilter.asp`: URL/keyword policy and rule table, 31-character UI limit.

Both filter enable checkboxes submit immediately after their confirmation popup.
Policy changes also submit immediately. An empty allow list can deny all access.
Do not toggle controls merely to inspect the page. MAC filtering is described by
the firmware as internet access control, not proven Wi-Fi deauthentication.
HTTPS URL-filter effectiveness has not been tested. These responses do not expose
search terms or browsing history.

## Offline verification

From the repository root:

```powershell
php scripts/router-snapshot.php 'C:\path\saved-LAN-response.html'
```

The command only reads the supplied file and prints JSON. It makes no network or
database calls. Output includes device identifiers; do not publish it. The parser
does not execute JavaScript, load resources, or render HTML. It bounds input and
record counts, requires both lists, validates records and rejects duplicate MACs.
Unknown layouts and login responses fail closed. Host names remain untrusted text
and must be escaped by any future UI. No real customer snapshot is checked in.

Snapshots always have `live: false`; router presence never implies device health,
agent enrollment or permission for remote control. Connection timestamps retain
the router's original string because its timezone is unverified. MAC addresses
are observations, not durable customer identities or authorization credentials.

## Remaining integration work

1. Inspect the unauthenticated login form and its referenced authentication logic.
   Configure credentials locally; do not request passwords or session cookies in chat.
2. Implement a LAN-local collector restricted to the configured router and verified
   paths. Detect session expiry and stale data explicitly; do not expose router WAN
   administration or allow arbitrary URLs through the server.
3. Add permission-gated network UI with last successful refresh and unknown/stale
   states. Health remains tied to separately enrolled, authenticated agents.
4. Before enabling mutations, add audited admin actions, fresh policy reads,
   management-device protection, duplicate checks and post-write readback. Never
   silently switch the whole network to an allow list. Test block and unblock on
   a designated device before claiming live enforcement.

Existing customer-consent remote support is unchanged; RustDesk transport is still
not integrated. No router action grants access to customer screens or files.
