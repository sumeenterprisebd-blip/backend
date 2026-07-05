const axios = require('axios');
const crypto = require('crypto');

const sha256Hex = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  return crypto.createHash('sha256').update(v).digest('hex');
};

const normalizeBdPhoneForMeta = (value) => {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('8801') && digits.length === 13) return digits;
  if (digits.startsWith('01') && digits.length === 11) return `880${digits.slice(1)}`;
  if (digits.startsWith('1') && digits.length === 10) return `880${digits}`;
  return digits;
};

const parseCookies = (cookieHeader) => {
  const header = String(cookieHeader || '');
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const [rawKey, ...rest] = part.split('=');
    const key = String(rawKey || '').trim();
    if (!key) return;
    const value = rest.join('=').trim();
    out[key] = decodeURIComponent(value);
  });
  return out;
};

exports.sendMetaCapiPurchase = async ({ req, order, eventId }) => {
  try {
    const pixelId = String(process.env.META_PIXEL_ID || '').trim();
    const accessToken = String(process.env.META_CAPI_ACCESS_TOKEN || '').trim();
    if (!pixelId || !accessToken) return;

    const apiVersion = String(process.env.META_API_VERSION || 'v20.0').trim();
    const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events`;

    const orderItems = Array.isArray(order?.orderItems) ? order.orderItems : [];
    const contents = orderItems
      .map((item) => {
        const id = item?.product?._id || item?.product;
        if (!id) return null;
        return {
          id: String(id),
          quantity: Number(item?.quantity || 0) || 0,
          item_price: Number(item?.price || 0) || 0,
        };
      })
      .filter(Boolean);

    const contentIds = contents.map((c) => c.id);
    const numItems = contents.reduce((sum, c) => sum + (Number(c.quantity) || 0), 0);

    const emailRaw = order?.shippingAddress?.email || order?.guestInfo?.email || '';
    const phoneRaw = order?.shippingAddress?.phone || order?.guestInfo?.phone || '';
    const email = String(emailRaw || '').trim().toLowerCase();
    const phoneE164Digits = normalizeBdPhoneForMeta(phoneRaw);

    const cookieMap = parseCookies(req?.headers?.cookie);
    // Prefer cookies from the incoming request, fall back to values stored on the order.client
    const fbp = String(cookieMap._fbp || order?.client?.fbp || '').trim();
    const fbc = String(cookieMap._fbc || order?.client?.fbc || '').trim();

    const userData = {
      client_ip_address: String(order?.client?.ipAddress || '').trim() || undefined,
      client_user_agent: String(order?.client?.userAgent || '').trim() || undefined,
      ...(email ? { em: [sha256Hex(email)] } : {}),
      ...(phoneE164Digits ? { ph: [sha256Hex(phoneE164Digits)] } : {}),
      ...(fbp ? { fbp } : {}),
      ...(fbc ? { fbc } : {}),
    };

    const value = Number(order?.total ?? 0) || 0;
    const currency = String(order?.currency || 'BDT') || 'BDT';
    const orderId = order?.orderNumber || (order?._id ? String(order._id) : undefined);

    const payload = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          ...(eventId ? { event_id: String(eventId) } : {}),
          ...(req?.get && req.get('referer') ? { event_source_url: req.get('referer') } : {}),
          user_data: userData,
          custom_data: {
            value,
            currency,
            content_type: 'product',
            ...(orderId ? { order_id: orderId } : {}),
            ...(contentIds.length ? { content_ids: contentIds } : {}),
            ...(contents.length ? { contents } : {}),
            ...(Number.isFinite(numItems) ? { num_items: numItems } : {}),
          },
        },
      ],
      access_token: accessToken,
    };

    const testCode = String(process.env.META_CAPI_TEST_EVENT_CODE || '').trim();
    if (testCode) payload.test_event_code = testCode;

    await axios.post(url, payload, { timeout: 4500 });
  } catch (err) {
    if (String(process.env.META_CAPI_DEBUG || '').toLowerCase() === 'true') {
      console.warn('Meta CAPI Purchase failed:', err?.response?.data || err?.message || err);
    }
  }
};
