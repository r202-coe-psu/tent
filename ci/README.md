# CI notifications (Discord)

Discord notifications for Jenkins build/deploy completion and for new GitHub pull requests and
issues. Infra only: nothing here touches the app, the data model or `docs/change-management.md` §2.

| Source | Mechanism | Lives in |
| --- | --- | --- |
| Jenkins build/deploy/E2E/janitor results | `ci/discord-notify.sh` called from `post { always }` | `Jenkinsfile`, `Jenkinsfile.e2e-staging`, `Jenkinsfile.e2e-janitor` |
| GitHub new PR / issue | GitHub repo webhook pointed at Discord's `/github` endpoint | GitHub repo settings (no code, no `.github/` workflow) |

`Jenkinsfile.prod`, `Jenkinsfile.staging` and `Jenkinsfile.old` are legacy and are not wired.

## 1. Create the Discord webhook

1. Discord: channel settings -> Integrations -> Webhooks -> New Webhook (pick the channel, e.g. `#ci`).
2. Copy the webhook URL (`https://discord.com/api/webhooks/<id>/<token>`).

The same URL is used for both Jenkins and GitHub (GitHub appends `/github`). Use one webhook per
channel; use separate webhooks if CI and GitHub traffic should go to different channels.

## 2. Jenkins credential

Manage Jenkins -> Credentials -> (global) -> Add Credentials:

- Kind: **Secret text**
- Secret: the Discord webhook URL
- ID: `tent-discord-webhook-ci` (exact; the Jenkinsfiles reference it)

If the credential is missing, the build is not affected: the pipeline logs a `WARNING` and continues.

### What gets posted

| Job | `NOTIFY_KIND` | When |
| --- | --- | --- |
| root `Jenkinsfile` (staging + main branches) | `deploy` | every completion; title says `staging` or `prod` (main). On staging the `E2E` field reads `TRIGGERED` — the result follows in a separate `e2e` message |
| `Jenkinsfile.e2e-staging` (`tent-e2e-staging`) | `e2e` | every result (the deploy job only triggers it, without waiting) |
| `Jenkinsfile.e2e-janitor` | `janitor` | on failure, or when `MODE=execute` (dry-run successes stay quiet) |

Notifications never fail a build: the script call uses `returnStatus: true` and the whole block is
wrapped in `try/catch`.

Known gap: `post` only runs once an agent/workspace exists. If a build fails before the `mgmt`
agent is allocated (for example no executor is available), no notification is sent. A job that
fails before `checkout scm` (or whose checked-out commit predates `ci/discord-notify.sh`) also
skips the notification because the script is not in the workspace.

## 3. `ci/discord-notify.sh` env contract

Inputs are environment variables only (never argv, so nothing secret reaches `ps`). Bash only, no
`jq`/`python3` needed.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | yes (unless `DRY_RUN=1`) | Webhook URL; secret. Empty -> warning on stderr, exit 0 |
| `NOTIFY_KIND` | yes | `build` / `deploy` / `e2e` / `janitor` (selects the title label) |
| `NOTIFY_RESULT` | yes | `SUCCESS` / `FAILURE` / `UNSTABLE` / `ABORTED` / `NOT_BUILT` (selects emoji and colour) |
| `NOTIFY_JOB` | recommended | Job name, shown in the title |
| `NOTIFY_BUILD_NUMBER` | recommended | Build number, shown in the title |
| `NOTIFY_BUILD_URL` | recommended | Embed title link |
| `NOTIFY_TARGET` | optional | `staging` / `prod`, appended to the title (`Deploy staging succeeded`) |
| `NOTIFY_BRANCH` | optional | `Branch` field |
| `NOTIFY_COMMIT` | optional | `Commit` field (a hex SHA is shortened to 7 chars) |
| `NOTIFY_DURATION` | optional | `Duration` field |
| `NOTIFY_E2E_RESULT` | optional | `E2E` field |
| `NOTIFY_DETAIL` | optional | Embed description |
| `NOTIFY_USERNAME` | optional | Per-message webhook name (top-level `username`, max 80 chars). Dropped with a stderr warning if it contains "discord" (Discord rejects it). Unset -> the webhook's default name |
| `NOTIFY_AVATAR_URL` | optional | Per-message avatar image (top-level `avatar_url`). Must start with `https://`, otherwise dropped with a stderr warning. Unset -> the webhook's default avatar |
| `DRY_RUN` | optional | `1` prints the JSON payload to stdout and sends nothing |

Behaviour notes:

- One embed, colour by result (green success, red failure, yellow unstable, grey otherwise),
  UTC ISO8601 timestamp, `allowed_mentions: {parse: []}` (a notification can never ping anyone).
- Values are JSON-escaped in pure bash and truncated to Discord's limits (title 256, field value
  1024, description 4096; byte-based, UTF-8 safe).
- Discord also caps the whole embed (title + description + field names/values) at 6000 chars. The
  title and fields keep their own caps and the description is truncated to what remains of
  6000 (minus a 50 char safety margin), so the total is always at most 6000.
- `NOTIFY_USERNAME` is trimmed of leading/trailing whitespace; if nothing is left it is dropped.
- POST uses `curl --fail --max-time 10 --retry 2`; the exit code is non-zero if it fails (Jenkins
  ignores it). The webhook URL is handed to curl through a config file descriptor, never echoed,
  never in `set -x` output (`set +x` is forced).

### Webhook identity (name and avatar)

The Jenkinsfiles set `NOTIFY_USERNAME` per job (`Tent Deploy`, `Tent E2E`, `Tent Janitor`) so the
messages are distinguishable in the channel. No avatar is set yet (no hosted image). To use one,
host a square image at a public `https://` URL and add `"NOTIFY_AVATAR_URL=https://..."` to the
`withEnv([...])` list in the `post` block of the Jenkinsfile(s), or change the webhook's default
avatar in Discord (channel settings -> Integrations -> Webhooks), which applies when the variable is
unset.

### Test locally

```bash
# Print the payload only (no URL needed, nothing is sent)
DRY_RUN=1 NOTIFY_KIND=deploy NOTIFY_TARGET=staging NOTIFY_RESULT=SUCCESS \
  NOTIFY_JOB=tent NOTIFY_BUILD_NUMBER=42 NOTIFY_BUILD_URL=https://jenkins.example/job/tent/42/ \
  NOTIFY_BRANCH=staging NOTIFY_COMMIT=0123456789abcdef0123456789abcdef01234567 \
  NOTIFY_DURATION='3 min 2 sec' NOTIFY_E2E_RESULT=SUCCESS \
  ./ci/discord-notify.sh | python3 -m json.tool

# Really send one message to a test webhook
read -rs DISCORD_WEBHOOK_URL && export DISCORD_WEBHOOK_URL
NOTIFY_KIND=build NOTIFY_RESULT=SUCCESS NOTIFY_JOB=tent-test NOTIFY_BUILD_NUMBER=1 ./ci/discord-notify.sh
```

## 4. GitHub: new PR / issue notifications

No code and no workflow: use GitHub's built-in webhook with Discord's GitHub-compatible endpoint.
Needs **repo admin**.

1. GitHub repo -> Settings -> Webhooks -> Add webhook.
2. Payload URL: `<discord webhook url>/github` (e.g. `https://discord.com/api/webhooks/<id>/<token>/github`).
3. Content type: `application/json`.
4. Secret: leave empty (Discord ignores it).
5. "Let me select individual events": tick **Issues** and **Pull requests** only; untick everything else
   (including Pushes).
6. Keep **Active** ticked and save.

Note that Discord posts on **all actions** of those events (opened, closed, reopened, labeled,
assigned, ...), not just newly opened ones, so the channel can get noisy. Use a dedicated channel.
Check the delivery log under the webhook's "Recent Deliveries" tab if nothing shows up.

## 5. Security notes

- The webhook URL is a **secret**: anyone holding it can post to the channel. Keep it only in the
  Jenkins credential store and the GitHub webhook setting; never commit it, put it in a ticket,
  or paste it in chat. Jenkins masks it in console logs when injected via `withCredentials`.
- Rotate on any suspected leak: Discord channel settings -> Integrations -> Webhooks -> delete (or
  regenerate) the webhook, create a new one, then update the Jenkins credential
  `tent-discord-webhook-ci` and the GitHub webhook Payload URL.
- Pipelines never interpolate the secret in Groovy strings; the script reads it from the
  environment and `allowed_mentions` is disabled so build data cannot trigger `@everyone`.
