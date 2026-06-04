import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import axios from 'axios';
import open from 'open';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  GH_OAUTH_AUTHORIZE,
  GH_OAUTH_TOKEN,
  GH_OAUTH_PORT,
  GH_OAUTH_REDIRECT,
  GH_SCOPES,
} from '../constants';
import { saveTokens } from '../client';
import { GoogleHealthTokens } from '../types';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_HEALTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    process.stderr.write(
      'Error: GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET must be set in .env or environment.\n' +
      'See README.md for the Google Cloud Console setup (enable the Health API, create an OAuth\n' +
      `client, and register the redirect URI ${GH_OAUTH_REDIRECT}).\n`
    );
    process.exit(1);
  }

  // PKCE — protects the code exchange even on the loopback redirect.
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

  // Random `state` defeats login-CSRF on the localhost callback.
  const expectedState = crypto.randomBytes(16).toString('hex');

  const authorizeUrl =
    `${GH_OAUTH_AUTHORIZE}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: GH_OAUTH_REDIRECT,
      response_type: 'code',
      scope: GH_SCOPES.join(' '),
      // access_type=offline + prompt=consent are REQUIRED to receive a refresh_token.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: expectedState,
    }).toString();

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('No URL');
        return;
      }
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const noStoreHeaders = {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      };
      const code = parsed.query.code as string | undefined;
      const state = parsed.query.state as string | undefined;
      const error = parsed.query.error as string | undefined;
      if (error) {
        res.writeHead(400, noStoreHeaders);
        res.end(`Google OAuth error: ${error}`);
        server.close();
        reject(new Error(`Google OAuth error: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400, noStoreHeaders);
        res.end('Missing code parameter');
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, noStoreHeaders);
        res.end('State parameter mismatch — rejecting callback. This is a CSRF protection.');
        server.close();
        reject(new Error('OAuth state mismatch — possible CSRF. Retry npm run oauth.'));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(
        '<html><body style="font-family:sans-serif;padding:2em">' +
        '<h1>Google Health authorized</h1>' +
        '<p>You can close this tab and return to the terminal.</p>' +
        '</body></html>'
      );
      server.close();
      resolve(code);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(
          `Port ${GH_OAUTH_PORT} is in use. Set GOOGLE_HEALTH_OAUTH_PORT to a free port ` +
          `(and update the registered redirect URI to match), then retry.\n`
        );
      }
      reject(err);
    });
    server.listen(GH_OAUTH_PORT, '127.0.0.1', () => {
      process.stderr.write(`Listening for OAuth callback at ${GH_OAUTH_REDIRECT}\n`);
    });
  });

  process.stderr.write(`Opening browser to authorize Google Health access...\n${authorizeUrl}\n`);
  try {
    await open(authorizeUrl);
  } catch {
    process.stderr.write(`Could not auto-open the browser. Visit this URL manually:\n${authorizeUrl}\n`);
  }

  const code = await codePromise;
  process.stderr.write('Authorization code received. Exchanging for tokens...\n');

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: GH_OAUTH_REDIRECT,
  });
  const res = await axios.post(GH_OAUTH_TOKEN, tokenBody, {
    timeout: 15_000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const body = res.data as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  if (!body.refresh_token) {
    process.stderr.write(
      'Warning: no refresh_token returned. Google only issues one on first consent with\n' +
      "access_type=offline + prompt=consent. If you've authorized before, revoke this app's\n" +
      'access at https://myaccount.google.com/permissions and re-run npm run oauth.\n'
    );
  }

  const tokens: GoogleHealthTokens = {
    client_id: clientId,
    client_secret: clientSecret,
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? '',
    expires_at: Math.floor(Date.now() / 1000) + body.expires_in,
    scope: body.scope,
    token_type: body.token_type,
  };

  saveTokens(tokens);
  process.stderr.write(
    `Tokens written successfully.\n` +
    `Granted scopes: ${tokens.scope}\n` +
    `Access token expires at: ${new Date(tokens.expires_at * 1000).toISOString()}\n`
  );
  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`Bootstrap failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
