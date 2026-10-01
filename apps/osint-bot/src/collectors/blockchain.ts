import { z } from 'zod';
import type { Collector, EntityRef } from './types.js';
import { fetchPublicJson, type PublicJsonOptions } from './public-json.js';

const statsSchema = z.object({
  funded_txo_count: z.number().int(),
  funded_txo_sum: z.number().int(),
  spent_txo_count: z.number().int(),
  spent_txo_sum: z.number().int(),
  tx_count: z.number().int(),
});
const bitcoinSchema = z.object({
  address: z.string(),
  chain_stats: statsSchema,
  mempool_stats: statsSchema,
});
const ethereumSchema = z.object({
  hash: z.string(),
  is_contract: z.boolean().optional(),
  is_verified: z.boolean().optional(),
  name: z.string().nullable().optional(),
  coin_balance: z.string().nullable().optional(),
  transactions_count: z.union([z.string(), z.number()]).nullable().optional(),
  token_transfers_count: z
    .union([z.string(), z.number()])
    .nullable()
    .optional(),
});

const addressEntity = (network: string, address: string): EntityRef => ({
  kind: 'CRYPTO_ADDRESS',
  key: `${network}:${address.toLowerCase()}`,
  label: address,
});

export const createBitcoinCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'BITCOIN_MEMPOOL_SPACE',
  supports: ['BITCOIN_ADDRESS'],
  priority: 70,
  collect: async (selector, signal) => {
    const response = await fetchPublicJson(
      `https://mempool.space/api/address/${encodeURIComponent(selector.value)}`,
      bitcoinSchema,
      { ...options, signal },
    );
    const balance =
      response.data.chain_stats.funded_txo_sum -
      response.data.chain_stats.spent_txo_sum;
    const entity = addressEntity('bitcoin', response.data.address);
    return [
      {
        sourceKey: `bitcoin:address:${response.data.address}`,
        sourceUrl: `https://mempool.space/address/${response.data.address}`,
        excerpt: `Bitcoin ${response.data.address} · ${response.data.chain_stats.tx_count} potvrzených transakcí · zůstatek ${balance} sat. Veřejná blockchainová aktivita nepotvrzuje vlastníka adresy.`,
        data: {
          network: 'bitcoin',
          address: response.data.address,
          confirmedTransactions: response.data.chain_stats.tx_count,
          confirmedFundedSats: response.data.chain_stats.funded_txo_sum,
          confirmedSpentSats: response.data.chain_stats.spent_txo_sum,
          confirmedBalanceSats: balance,
          mempoolTransactions: response.data.mempool_stats.tx_count,
        },
        findings: [
          {
            entity,
            predicate: 'PUBLIC_BLOCKCHAIN_BALANCE_SATS',
            value: String(balance),
          },
          {
            entity,
            predicate: 'PUBLIC_BLOCKCHAIN_TX_COUNT',
            value: String(response.data.chain_stats.tx_count),
          },
        ],
        links: [],
      },
    ];
  },
});

export const createEthereumCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'ETHEREUM_BLOCKSCOUT',
  supports: ['ETHEREUM_ADDRESS'],
  priority: 70,
  collect: async (selector, signal) => {
    const response = await fetchPublicJson(
      `https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(selector.value)}`,
      ethereumSchema,
      { ...options, signal },
    );
    const entity = addressEntity('ethereum', response.data.hash);
    return [
      {
        sourceKey: `ethereum:address:${response.data.hash.toLowerCase()}`,
        sourceUrl: `https://eth.blockscout.com/address/${response.data.hash}`,
        excerpt: `Ethereum ${response.data.hash} · ${response.data.transactions_count ?? '?'} transakcí · balance ${response.data.coin_balance ?? '?'}. Veřejná blockchainová aktivita nepotvrzuje vlastníka adresy.`,
        data: {
          network: 'ethereum',
          address: response.data.hash,
          name: response.data.name ?? null,
          contract: response.data.is_contract ?? null,
          verified: response.data.is_verified ?? null,
          balanceWei: response.data.coin_balance ?? null,
          transactions: String(response.data.transactions_count ?? ''),
          tokenTransfers: String(response.data.token_transfers_count ?? ''),
        },
        findings: [
          ...(response.data.coin_balance
            ? [
                {
                  entity,
                  predicate: 'PUBLIC_BLOCKCHAIN_BALANCE_WEI',
                  value: response.data.coin_balance,
                },
              ]
            : []),
          ...(response.data.transactions_count !== undefined
            ? [
                {
                  entity,
                  predicate: 'PUBLIC_BLOCKCHAIN_TX_COUNT',
                  value: String(response.data.transactions_count),
                },
              ]
            : []),
        ],
        links: [],
      },
    ];
  },
});
