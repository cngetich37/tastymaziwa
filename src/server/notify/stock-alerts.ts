/**
 * WhatsApp the shop owner when stock moves: milk or a product received,
 * written off, or one of those cancelled, and when a sale takes an item to
 * low stock. Runs after the entry is committed (see `alertStock` in
 * app/actions.ts) and never affects the entry itself.
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db/client';
import { ledgerEntries, products, shops, suppliers } from '@/db/schema';
import { stockAlertText } from '@/lib/calc/stock-alert';
import { getItemOnHand } from '../queries';
import { sendWhatsAppTemplate, type SendOutcome, type WhatsAppTemplateMessage } from './whatsapp';

const STOCK_KINDS = ['delivery', 'sale', 'spoilage'] as const;
type StockKind = (typeof STOCK_KINDS)[number];
const isStockKind = (kind: string): kind is StockKind => (STOCK_KINDS as readonly string[]).includes(kind);

export type Send = (msg: WhatsAppTemplateMessage) => Promise<SendOutcome>;

/**
 * Message the owner about one ledger entry, if the shop has a WhatsApp number
 * set and the movement is worth a message. The entry is looked up by id and
 * shop, so an id from another shop sends nothing. Returns the message text, or
 * null when nothing was sent.
 */
export async function notifyStockChange(
  db: DB,
  shopId: string,
  entryId: string,
  send: Send = sendWhatsAppTemplate,
): Promise<string | null> {
  const [entry] = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.shopId, shopId)));
  if (!entry || !isStockKind(entry.kind) || entry.volumeMl === 0) return null;

  const [shop] = await db
    .select({ name: shops.name, to: shops.stockAlertWhatsapp })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (!shop?.to) return null;

  const [product] = entry.productId
    ? await db
        .select({ name: products.name, unit: products.unit, reorderLevel: products.reorderLevel })
        .from(products)
        .where(and(eq(products.id, entry.productId), eq(products.shopId, shopId)))
    : [];
  const [supplier] = entry.supplierId
    ? await db
        .select({ name: suppliers.name })
        .from(suppliers)
        .where(and(eq(suppliers.id, entry.supplierId), eq(suppliers.shopId, shopId)))
    : [];

  const text = stockAlertText({
    kind: entry.kind,
    reversal: entry.reversesId != null,
    volume: entry.volumeMl,
    itemName: product?.name ?? 'fresh milk',
    unit: product?.unit ?? 'litre',
    onHandAfter: await getItemOnHand(db, shopId, entry.productId),
    reorderLevel: product?.reorderLevel ?? null,
    supplierName: supplier?.name,
    reason: entry.kind === 'spoilage' ? entry.expenseCategory : null,
  });
  if (!text) return null;

  await send({
    to: shop.to,
    template: process.env.WHATSAPP_STOCK_TEMPLATE ?? 'stock_update',
    language: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en',
    params: [shop.name, text],
  });
  return text;
}
