'use client';

import React, { useState } from 'react';

const formText = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const scopes = [
  'events',
  'articles',
  'news',
  'publications',
  'social-posts',
] as const;

/** Creates a bot credential and shows its token once. */
export const CreateCredential = () => {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setToken(null);
    try {
      const expires = Number(form.get('expiresInDays'));
      const response = await fetch('/api/ingest/credentials', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formText(form, 'name'),
          botId: formText(form, 'botId'),
          scopes: form
            .getAll('scopes')
            .filter((value): value is string => typeof value === 'string'),
          ...(expires > 0 ? { expiresInDays: expires } : {}),
        }),
      });
      const body = (await response.json()) as {
        token?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.token)
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      setToken(body.token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="vch-credential-form">
      <summary>Create bot credential</summary>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Name <input name="name" required maxLength={100} />
        </label>
        <label>
          Bot id{' '}
          <input
            name="botId"
            required
            pattern="[a-z0-9][a-z0-9-]{1,62}"
            placeholder="brno-events-agent"
          />
        </label>
        <fieldset>
          <legend>Scopes</legend>
          {scopes.map((scope) => (
            <label key={scope}>
              <input name="scopes" type="checkbox" value={scope} /> {scope}
            </label>
          ))}
        </fieldset>
        <label>
          Expires in days{' '}
          <input name="expiresInDays" type="number" min={1} max={3650} />
        </label>
        <button disabled={busy} type="submit">
          {busy ? 'Creating…' : 'Create'}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {token ? (
        <p>
          Copy this token into the bot&apos;s runtime env now. It is not shown
          again:
          <input
            readOnly
            value={token}
            onFocus={(event) => event.currentTarget.select()}
          />
        </p>
      ) : null}
    </details>
  );
};
