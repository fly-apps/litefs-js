<div align="center">
<h1>litefs-js 🎈</h1>

<p>
JavaScript utilities for working with
<a href="https://fly.io/docs/litefs/getting-started/">LiteFS</a>
on <a href="https://fly.io">Fly.io</a>
</p>
</div>

---

<!-- prettier-ignore-start -->
[![Build Status][build-badge]][build]
[![version][version-badge]][package]
[![MIT License][license-badge]][license]
<!-- prettier-ignore-end -->

## The problem

Deploying your app to multiple regions along with your data is a great way to
make your app really fast, but there are two issues:

1. Read replica instances can only read from the database, they cannot write to
   it.
2. There's an edge case where the user could write to the primary instance and
   then read from a replica instance before replication is finished.

Here's how we visualize that:

![a visualization of the user making a request which is sent to a read replica and replayed to the primary instance](https://user-images.githubusercontent.com/1500684/215623618-85620188-b7f7-458b-90cf-d1844b3d6d63.png)

![continuing the previous visualization with the edge case that the read replica responds to a get request before the replication has finished](https://user-images.githubusercontent.com/1500684/215623612-68909248-67ae-483c-8e92-1e9f292ee3e9.png)

## This solution

This module comes with several utilities to help you work around these issues.
Specifically, it allows you an easy way to add a special cookie to the client
that identifies the client's "transaction number" which is then used by read
replicas to compare to their local transaction number and force the client to
wait until replication has finished if necessary (with a timeout).

Here's how we visualize that:

![a visualization that shows the primary server sending a transaction number to the client and then the subsequent get request is sent to the replica which waits for replication to finish before responding](https://user-images.githubusercontent.com/1500684/215623623-3815a1bf-2263-4d5f-9720-cd8dc23eb027.png)

## Installation

This module is distributed via [npm][npm] which is bundled with [node][node] and
should be installed as one of your project's `dependencies`:

```
npm install --save litefs-js
```

Unless you plan on using lower-level utilities, you'll need to set two
environment variables on your server:

- `LITEFS_DIR` - the directory where the `.primary` file is stored. This should
  be what you set your `fuse.dir` config to in the `litefs.yml` config.
- `DATABASE_FILENAME` - the filename of your sqlite database. This is used to
  determine the location of the `-pos` file which LiteFS uses to track the
  transaction number.

## Usage

Integrating this with your existing server requires integration in two places:

1. Setting the transaction number cookie on the client after mutations have
   finished
2. Waiting for replication to finish before responding to requests

Low-level utilities are exposed, but higher level utilities are also available
for `express` and `remix`.

### Express

```ts
import express from 'express'
import {
	getSetTxNumberMiddleware,
	getTransactionalConsistencyMiddleware,
	getEnsurePrimaryMiddleware,
} from 'litefs-js/express'

const app = express()
// this should appear before any middleware that mutates the database
app.use(getEnsurePrimaryMiddleware())

// this should appear before any middleware that retrieves something from the database
app.use(getTransactionalConsistencyMiddleware())

// ... other middleware that might mutate the database here
app.use(getSetTxNumberMiddleware())

// ... middleware that send the response here
```

The tricky bit here is that often your middleware that mutates the database is
also responsible for sending the responses, so you may need to use a lower-level
utility like `setTxCookie` to set the cookie after mutations.

### Remix

Until we have proper middleware support in Remix, you'll have to use the express
or other lower-level utilities. You cannot currently use this module with the
built-in Remix server because there's no way to force the server to wait before
calling your loaders. Normally, you just need to use
`getTransactionalConsistencyMiddleware` in express, and then you can use
`appendTxNumberCookie` as shown below.

Of course, instead of using express with
`getTransactionalConsistencyMiddleware`, you could use
`await handleTransactionalConsistency(request)` to the top of every loader if
you like:

```tsx
// app/root.tsx (and app/routes/*.tsx... and every other loader in your app)
export function loader({ request }: DataFunctionArgs) {
	await handleTransactionalConsistency(request)
	// ... your loader code here
}
```

The same thing applies to `getEnsurePrimaryMiddleware` as well. If you need or
like, you can use `await ensurePrimary()` in every `action` call or any
`loader`s that mutate the database (of which, there should be few because you
should avoid mutations in loaders).

We're umm... really looking forward to Remix middleware...

The `appendTxNumberCookie` utility should be used in the `entry.server.ts` file
in both the `default` export (normally people call this `handleDocumentRequest`
or `handleRequest`) and the `handleDataRequest` export.

```tsx
// app/entry.server.ts
import { appendTxNumberCookie } from 'litefs-js/remix'

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	remixContext: EntryContext,
) {
	// Most of the time, all mutations are finished by now, but just make sure
	// you're finished with all mutations before this line:
	await appendTxNumberCookie(request, responseHeaders)
	// send the response
}

export async function handleDataRequest(
	response: Response,
	{ request }: Parameters<HandleDataRequestFunction>[1],
) {
	// Most of the time, all mutations are finished by now, but just make sure
	// you're finished with all mutations before this line:
	await appendTxNumberCookie(request, response.headers)
	return response
}
```

### Other

There are several other lower-level utilities that you can use. They allow for
more customization and are documented via jsdoc. Utilities you may find helpful:

- `ensurePrimary` - Use this to ensure that the server that's handling the
  request is the primary server. This is useful if you know you need to do a
  mutation for that request.
- `getInstanceInfo` - get the `currentInstance` and `primaryInstance` hostnames
  from the filesystem.
- `waitForUpToDateTxNumber` - wait for the local transaction number to match the
  one you give it
- `getTxNumber` - read the transaction number from the filesystem.
- `getTxSetCookieHeader` - get the `Set-Cookie` header value for the transaction
  number
- `checkCookieForTransactionalConsistency` - the logic used to check the
  transaction number cookie for consistency and wait for replication if
  necessary.

## How it works

This module uses the special `.primary` directory in your Fuse filesystem to
determine the primary
([litefs primary docs](https://fly.io/docs/litefs/primary/)), and the `-pos`
file to determine the transaction number
([litefs transaction number docs](https://fly.io/docs/litefs/position/)).

When necessary, replay requests are made by responding with a 409 status code
and a `fly-replay` header
([docs on dynamic request routing](https://fly.io/docs/reference/dynamic-request-routing/)).

## Inspiration

This was built to make it much easier for people to take advantage of
distributed SQLite with LiteFS on Fly.io. The bulk of the logic was extracted
from
[kentcdodds/kentcdodds.com](https://github.com/kentcdodds/kentcdodds.com/blob/96d76de72a4a48089f2eb22a88a6ad1c6f847fa1/server/fly.ts).

## LICENSE

MIT

<!-- prettier-ignore-start -->
[npm]: https://www.npmjs.com
[node]: https://nodejs.org
[build-badge]: https://img.shields.io/github/actions/workflow/status/fly-apps/litefs-js/validate.yml?logo=github&style=flat-square
[build]: https://github.com/fly-apps/litefs-js/actions?query=workflow%3Avalidate
[version-badge]: https://img.shields.io/npm/v/litefs-js.svg?style=flat-square
[package]: https://www.npmjs.com/package/litefs-js
[license-badge]: https://img.shields.io/npm/l/litefs-js.svg?style=flat-square
[license]: https://github.com/fly-apps/litefs-js/blob/main/LICENSE
<!-- prettier-ignore-end -->
