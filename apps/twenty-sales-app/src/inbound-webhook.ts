declare const process: { env: Record<string, string | undefined> };

export const postInboundWebhook = async (payload: unknown) => {
  const webhookUrl = process.env.SALES_INBOUND_WEBHOOK_URL;
  const webhookToken = process.env.SALES_INBOUND_WEBHOOK_TOKEN;
  if (!webhookUrl || !webhookToken)
    throw new Error('Sales inbound webhook application variables are missing');

  const url = new URL(webhookUrl);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Sales inbound webhook URL must use HTTP or HTTPS');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webhookToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const responseText = (await response.text()).replaceAll(/\s+/gu, ' ');
    throw new Error(
      `Sales inbound webhook failed with HTTP ${response.status}: ${responseText.slice(0, 300)}`,
    );
  }
  return { notified: true };
};
