import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

interface OrderItem {
  name: string
  sku: string
  pack: string
  qty: string
  price: string
}

interface OrderPayload {
  order_number: string
  order_date: string
  delivery_date: string
  items: OrderItem[]
  raw_html: string
}

function parseOrderHtml(html: string): { order_number: string; delivery_date: string; items: OrderItem[] } {
  // Order number: matches both 07007285 and TCW8681224188
  const orderMatch = html.match(/Order Number[^>]*>\s*([A-Z0-9]+)/i)
    || html.match(/order\s+(?:number|#)[:\s]*([A-Z0-9]+)/i)
    || html.match(/>\s*(TCW[A-Z0-9]+)\s*</i)
    || html.match(/>\s*(\d{7,12})\s*</)
  const order_number = orderMatch ? orderMatch[1].trim() : 'UNKNOWN'

  // Delivery date
  const deliveryMatch = html.match(/Requested Delivery[^>]*>\s*([^<]+)/i)
    || html.match(/Requested Delivery[:\s]*([0-9\/\-]+)/i)
  const delivery_date = deliveryMatch ? deliveryMatch[1].trim() : ''

  const items: OrderItem[] = []

  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const itemPattern = /([A-Z][A-Z0-9 ]+\d{5})\s+(\d{5})\s+([\w\s\d]+?)\s+(\d+\s+(?:Case|Piece|Each|Bag|Box|Lb))\s+\$\s*([\d.]+)/gi
  let match
  while ((match = itemPattern.exec(text)) !== null) {
    items.push({
      name: match[1].trim(),
      sku: match[2].trim(),
      pack: match[3].trim(),
      qty: match[4].trim(),
      price: match[5].trim()
    })
  }

  return { order_number, delivery_date, items }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const payload: OrderPayload = await req.json()
    const { raw_html, order_number: provided_order, delivery_date: provided_delivery } = payload

    const parsed = parseOrderHtml(raw_html)
    const order_number = provided_order || parsed.order_number
    const delivery_date = provided_delivery || parsed.delivery_date
    const items = payload.items?.length ? payload.items : parsed.items

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No items found', alerts: 0 }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const skus = items.map((i: OrderItem) => i.sku).filter(Boolean)

    const { data: blocked, error } = await supabase
      .from('ingredient_vendors')
      .select('id, vendor_sku, do_not_order_reason, ingredients(name)')
      .eq('do_not_order', true)
      .in('vendor_sku', skus)

    if (error) throw error

    let alertCount = 0

    for (const blockedItem of (blocked || [])) {
      const orderItem = items.find((i: OrderItem) => i.sku === blockedItem.vendor_sku)
      if (!orderItem) continue

      const ingredientName = (blockedItem.ingredients as any)?.name || orderItem.name
      const reason = blockedItem.do_not_order_reason || ''

      const message = 'ORDINE BLOCCATO: ' + ingredientName +
        ' (SKU ' + blockedItem.vendor_sku + ')' +
        ' presente nella conferma ordine #' + order_number +
        ' (consegna ' + delivery_date + ')' +
        (reason ? ' — Motivo: ' + reason : '') +
        ' — Qty: ' + orderItem.qty + ' $' + orderItem.price +
        ' — Contatta il fornitore per cancellare.'

      await supabase.from('office_items').insert({
        type: 'order_alert',
        priority: 'orange',
        title: 'Articolo bloccato in ordine: ' + ingredientName,
        message,
        metadata: {
          order_number,
          delivery_date,
          vendor: "Chef's Warehouse",
          sku: blockedItem.vendor_sku,
          ingredient_name: ingredientName,
          qty: orderItem.qty,
          price: orderItem.price,
          do_not_order_reason: reason
        }
      })

      alertCount++
    }

    return new Response(JSON.stringify({
      ok: true,
      order_number,
      items_checked: items.length,
      alerts: alertCount
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('hardies-order-check error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
