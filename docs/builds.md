# Atlas development and internal preview builds

Both profiles target physical iOS and Android devices. `development` builds a
custom Expo development client that loads the app from Metro. `preview` bundles
the app for internal testers and runs without Metro. Neither is a store build.

## One-time owner setup

1. Use Node.js 26.9.0 (the version selected in `eas.json`) and npm. From the
   **repository root**, run `npm ci --ignore-scripts` to install the locked
   workspace dependencies for local development. Do not install from an isolated
   copy of `packages/app`; EAS needs the other workspaces and root lockfile.
2. Confirm or replace the provisional `com.tehioant.atlas` iOS bundle ID and
   Android package in `packages/app/app.json` before registering/signing. These
   are not claimed identifiers. Both profiles share the app identity, so don't
   plan on installing them side by side; use separate devices or replace the
   installed profile as appropriate. Uninstalling can erase device-local data.
3. From **`packages/app`**, sign in as an authorized Expo account member
   (`npx eas-cli@27.10.0 login`). In the intended project's Expo dashboard,
   verify its owner and slug and copy its Project ID into the shell variable
   `EAS_PROJECT_ID`. [Link by ID](https://docs.expo.dev/eas/cli/#eas-projectinit)
   without uploading an icon:

   ```sh
   npx eas-cli@27.10.0 project:init --id "${EAS_PROJECT_ID:?Set the verified project ID}" --no-icon
   ```

   Check `owner`, `slug` and `extra.eas.projectId` in the updated `app.json`
   against the dashboard before building. If prompted to change the owner or
   slug, continue only if they match the intended project. If no project exists,
   stop; creating one is a separate owner decision. The source checkout ships
   without a project ID or signing credentials.
4. For **iOS**, the owner needs a paid Apple Developer Program team and signing
   access. Register each test iPhone (`npx eas-cli@27.10.0 device:create`) and
   ensure its UDID is included in the signed ad hoc provisioning profile. Run
   the first build interactively for signing setup. These are device IPAs, not
   simulator builds. For **Android**, authorize EAS to create or reuse the
   Android signing keystore for the selected package. The output is a signed
   APK, not an AAB; no Google Play submission is needed.

## Set the game server per profile

In the linked project's [EAS environment variables](https://docs.expo.dev/eas/environment-variables/manage/),
set the **project-wide** plain-text `EXPO_PUBLIC_SERVER_URL` separately in
`development` and `preview`, using the matching server's full WebSocket URL
including `/ws`. Prefer project scope so another project cannot inherit this
setting. Avoid defining the same key at account scope, in a profile's `env`,
or in files shipped to the builder. Do not put credentials in this URL: `EXPO_PUBLIC_*`
values are readable in the app bundle. Set the preview value **before** building;
changing it later requires a fresh preview build.

Use `wss://` with a trusted certificate for device testing. Account derives
HTTPS endpoints on the same origin and refuses to send credentials over plain
HTTP; see [Account configuration](account.md). If the variable is unset, Atlas
falls back to `ws://127.0.0.1:3000/ws`. On a physical phone that points to the
phone, not the developer machine, so it will not reach your server there.

## Produce and install a build

Run the appropriate command from **`packages/app`**, after owner setup. These
commands request hosted EAS builds; they do not build locally or publish to a
store.

```sh
npx eas-cli@27.10.0 build --profile development --platform ios
npx eas-cli@27.10.0 build --profile development --platform android
npx eas-cli@27.10.0 build --profile preview --platform ios
npx eas-cli@27.10.0 build --profile preview --platform android
```

Open the finished build's EAS install link on the target device. On iOS, confirm
that the device is covered by the build's ad hoc profile (rebuild or re-sign if
it was added later) and enable Developer Mode if prompted. On Android, install
the APK and allow installs from that source if prompted. For sharing or adding
new devices, see [Expo's internal distribution guide](https://docs.expo.dev/build/internal-distribution/).

For a **development** build, set `EXPO_PUBLIC_SERVER_URL` in the ignored
`packages/app/.env.local` to the development server the device can reach. Expo's
local Metro reads the local value; the EAS `development` environment does not
populate it automatically. Then, from **`packages/app`**:

```sh
npx expo start --dev-client
```

Open the installed development client using Metro's QR code on the same
reachable network. Reload after changing the server URL. For **preview**, open
the installed app directly; it uses the server URL bundled by EAS.
