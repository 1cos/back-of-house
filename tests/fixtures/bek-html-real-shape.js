'use strict';
// MICRO-TASK 42 — fixture che riproduce la STRUTTURA REALE del template
// SendGrid usato da Ben E. Keith (osservata sul MIME/HTML di produzione),
// non una versione semplificata. Nessun dato reale di produzione: SKU,
// nomi, brand, prezzi e date sono rappresentativi.
//
// Caratteristiche strutturali che questa fixture esercita e che la
// fixture "minimale" (bek-html-sample.js) NON ha:
//   - Sales Order dentro <th colspan="4"> nel <thead>, non in un <p>
//   - Delivery Date / Order Total come label+valore su DUE <tr> distinti
//     di una <table> annidata dentro <td class="cell-wrapper">
//   - wrapper esterno <table><tr><td> che avvolge l'intero documento
//   - cella PRICE con <table> annidata ("$82.73" / "per case")
//   - cella STATUS con <div class="status-val">Filled<br></div>
//   - riga finale <tr><td colspan="8"> con la nota sul totale
//   - entita &apos; dentro un nome brand
//
// Totale dichiarato = somma(prezzo * confirmed), come nel documento vero.

const BEK_HTML_REAL_SHAPE = `
<!DOCTYPE html>
<html>
  <head><link href="https://fonts.googleapis.com/css2?family=Open+Sans" rel="stylesheet"></head>
  <body style="font-family: Open Sans, sans-serif;">
    <div class="container-fluid">
    <table class="display-logo" cellspacing="0" cellpadding="0" align="center" width="100%">
        <tbody align="left">
          <tr>
            <td>
      <table class="mail-body" cellspacing="0" cellpadding="0">
                <tbody>
                  <tr>
                        <td style="color: #424242;font-size: 12px;">
                        Please do not reply to this message. If you need
                        assistance, please contact your sales representative
                        or visit the <a href="https://example.invalid/c" target="_blank">Contact Us</a> page.
                        </td>
                    </tr>
                </tbody>
              </table>
      <table align="center" class="header-title" cellspacing="0" cellpadding="0">
        <tbody>
          <tr>
            <td style="color: #494949;font-size: 26px;font-weight: bold;">
              Your order is confirmed and ready for delivery
            </td>
          </tr>
        </tbody>
      </table>
    <table align="center" class="invoice-details" cellspacing="0" cellpadding="0">
      <thead>
        <tr>
          <th colspan="4" align="left" style="background-color: #ECF1F9;">Sales Order # <b>0009111222</b></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="cell-wrapper" valign="top">
            <table>
              <tbody>
              <tr><td class="label">Customer Name</td></tr>
              <tr><td><b>ZENO&apos;S ON THE SQUARE</b></td></tr>
              </tbody>
            </table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table>
              <tbody>
              <tr><td class="label">Customer#</td></tr>
              <tr><td><b>FDF770366</b></td></tr>
              </tbody>
            </table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table>
              <tbody>
              <tr><td class="label">PO#</td></tr>
              <tr><td><b></b></td></tr>
              </tbody>
            </table>
          </td>
          <td class="cell-wrapper" valign="top">
             <table>
              <tbody>
              <tr><td class="label">Branch</td></tr>
              <tr><td><b>FDF</b></td></tr>
              </tbody>
            </table>
          </td>
        </tr>
        <tr>
          <td class="cell-wrapper" valign="top">
            <table>
              <tbody>
              <tr><td class="label">Delivery Date</td></tr>
              <tr><td><b>09/17/2026</b></td></tr>
              </tbody>
            </table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table>
              <tbody>
              <tr><td class="label">Quantity</td></tr>
              <tr><td><b>3 items/</b></td></tr>
              <tr><td><b>6 pieces</b></td></tr>
              </tbody>
            </table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table>
              <tbody>
              <tr><td class="label">Order Total*</td></tr>
              <tr><td style="text-align: left;"><b>$312.18</b></td></tr>
                <tr><td class="label">Email: raven_wolf_1510@yahoo.com</td></tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>

    <table align="center" class="products-table" cellspacing="0" cellpadding="0">
      <thead>
        <tr>
          <th valign="top" width="5%">ITEM#</th>
          <th valign="top" width="27%">ITEM <div>NAME</div></th>
          <th valign="top" width="15%">BRAND</th>
          <th valign="top" width="10%">PACK/SIZE</th>
          <th valign="top" width="12%">PRICE</th>
          <th valign="top" width="5%">ORDERED</th>
          <th valign="top" width="5%">CONFIRMED</th>
          <th valign="top" width="5%">STATUS</th>
        </tr>
      </thead>
      <tbody>
        <tr class="">
          <td valign="top">110593</td>
          <td valign="top">Cheese Mascarpone</td>
          <td valign="top">Belgioioso</td>
          <td valign="top">4/ 5 LB</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$82.73</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">1</td>
          <td valign="top"><div class="status-val">Filled<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">688017</td>
          <td valign="top">Flour Pizza 00</td>
          <td valign="top">Rotella&apos;s Italian Bakery</td>
          <td valign="top">1/ 55 LB</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$50.92</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">4</td>
          <td valign="top" class="text-right">4</td>
          <td valign="top"><div class="status-val">Filled<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">130882</td>
          <td valign="top">Glove Nitrile Xl Pf Black</td>
          <td valign="top">Essentials</td>
          <td valign="top">10/ 100 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$26.05</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">2</td>
          <td valign="top" class="text-right">1</td>
          <td valign="top"><div class="status-val">Backordered<br>
                    </div></td>
        </tr>

         <tr><td valign="top" class="text-right" colspan="8">
            *This is your order total without taxes, fees and final weight prices.
          </td></tr>
      </tbody>
    </table>
    <table class="footer" align="center" cellspacing="0" cellpadding="0" width="100%">
        <tbody>
            <tr>
              <td style="width: 30px;"></td>
              <td class="footer-text help"><a href="https://example.invalid/h" target="_blank">Need Help?</a></td>
            </tr>
          </tbody>
    </table>
    <table class="copyright" align="center" cellspacing="0" cellpadding="0">
      <tbody>
        <tr><td><br></td></tr>
        <tr><td align="center" colspan="4">Copyright &#169; 2026 Ben E. Keith Co. All Rights Reserved.</td></tr>
      </tbody>
    </table>
    </td>
          </tr>
        </tbody>
    </table>
    </div>
  </body>
</html>
`;

const SUBJECT_REAL_SHAPE = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0009111222";
const FROM_REAL_SHAPE = 'CRP-SVCMBX-entree@benekeith.com';

// Atteso, calcolato a mano dal documento sopra:
//   110593  $82.73 x 1 =  82.73
//   688017  $50.92 x 4 = 203.68
//   130882  $26.05 x 1 =  26.05   (ordered 2, confirmed 1 -> usa 1)
//                        -------
//                         312.46 subtotale da CONFIRMED
// Order Total dichiarato: $312.18 (differisce di 0.28: nel documento reale
// il totale e "without taxes, fees and final weight prices", quindi la
// reconciliation deve avere una tolleranza, non un confronto esatto).
const EXPECTED_REAL_SHAPE = {
  document_number: '0009111222',
  delivery_date: '2026-09-17',
  total: 312.18,
  item_count: 3,
  skus: ['110593', '688017', '130882'],
  confirmed: [1, 4, 1],
  ordered: [1, 4, 2],
  unit_prices: [82.73, 50.92, 26.05],
  statuses: ['filled', 'filled', 'backordered'],
};

module.exports = {
  BEK_HTML_REAL_SHAPE,
  SUBJECT_REAL_SHAPE,
  FROM_REAL_SHAPE,
  EXPECTED_REAL_SHAPE,
};

// ── MICRO-TASK 42: fixture per classificazione, quantita e riconciliazione ──
// Strutturalmente identiche al template SendGrid reale (tabella prezzo
// annidata, status in <div class="status-val">, wrapper esterno).

const BEK_ACKNOWLEDGEMENT = `
<!DOCTYPE html>
<html><body style="font-family: Open Sans, sans-serif;">
    <div class="container-fluid">
    <table class="display-logo" cellspacing="0" cellpadding="0" align="center" width="100%">
        <tbody align="left"><tr><td>
      <table align="center" class="header-title" cellspacing="0" cellpadding="0">
        <tbody><tr><td style="color: #494949;font-size: 26px;font-weight: bold;">
              Thank you for your order!
        </td></tr></tbody>
      </table>
	<table align="center" class="header-title" cellspacing="0" cellpadding="0">
		<tbody><tr><td style="color: #494949;font-size: 16px;">
			Disclaimer: <strong>Item confirmation will occur the morning before your selected ship date. Please check your order details the day before you are expecting your delivery to ensure your items have been filled.</strong>
		</td></tr></tbody>
	</table>
    <table align="center" class="invoice-details" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th colspan="4" align="left">Sales Order # <b>0003126637</b></th>
      </tr></thead>
      <tbody>
        <tr>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Delivery Date</td></tr>
              <tr><td><b>09/17/2026</b></td></tr>
            </tbody></table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Order Total*</td></tr>
              <tr><td style="text-align: left;"><b>$312.86</b></td></tr>
                <tr><td class="label">Email: raven_wolf_1510@yahoo.com</td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody>
    </table>

    <table align="center" class="products-table" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th valign="top">ITEM#</th><th valign="top">ITEM <div>NAME</div></th>
          <th valign="top">BRAND</th><th valign="top">PACK/SIZE</th>
          <th valign="top">PRICE</th><th valign="top">ORDERED</th>
          <th valign="top">CONFIRMED</th><th valign="top">STATUS</th>
      </tr></thead>
      <tbody>
        <tr class="">
          <td valign="top">145832</td>
          <td valign="top">Ice Cube Sphere Round</td>
          <td valign="top">Vault Ice</td>
          <td valign="top">15/ 5 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$66.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Requested<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">860055</td>
          <td valign="top">Lid Plas 16sl Trans Slotted</td>
          <td valign="top">Dart</td>
          <td valign="top">10/ 100 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$31.07</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Requested<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">115846</td>
          <td valign="top">Toilet Tissue 2 Ply White Iw</td>
          <td valign="top">Essentials</td>
          <td valign="top">80/ 550 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$61.79</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Requested<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">887056</td>
          <td valign="top">Detergent Speed Clean</td>
          <td valign="top">Essentials</td>
          <td valign="top">1/ 5 GAL</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$154.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Requested<br>
                    </div></td>
        </tr>

         <tr><td valign="top" colspan="8">
            *This is your order total without taxes, fees and final weight prices.
          </td></tr>
      </tbody>
    </table>
    <table class="footer" align="center" cellspacing="0" cellpadding="0" width="100%">
        <tbody><tr>
              <td class="footer-text help"><a href="https://example.invalid/h" target="_blank">Need Help?</a></td>
              <td class="footer-text about"><a href="https://example.invalid/a" target="_blank">About Ben E. Keith</a></td>
        </tr></tbody>
    </table>
    <table class="copyright" align="center" cellspacing="0" cellpadding="0">
      <tbody>
        <tr><td><br></td></tr>
        <tr><td align="center" colspan="4">Copyright &#169; 2026 Ben E. Keith Co. All Rights Reserved.</td></tr>
      </tbody>
    </table>
    </td></tr></tbody>
    </table>
    </div>
</body></html>
`;

const BEK_ACK_MISLEADING_HEADER = `
<!DOCTYPE html>
<html><body style="font-family: Open Sans, sans-serif;">
    <div class="container-fluid">
    <table class="display-logo" cellspacing="0" cellpadding="0" align="center" width="100%">
        <tbody align="left"><tr><td>
      <table align="center" class="header-title" cellspacing="0" cellpadding="0">
        <tbody><tr><td style="color: #494949;font-size: 26px;font-weight: bold;">
              Your order is confirmed and ready for delivery
        </td></tr></tbody>
      </table>
	<table align="center" class="header-title" cellspacing="0" cellpadding="0">
		<tbody><tr><td style="color: #494949;font-size: 16px;">
			Disclaimer: <strong>Item confirmation will occur the morning before your selected ship date. Please check your order details the day before you are expecting your delivery to ensure your items have been filled.</strong>
		</td></tr></tbody>
	</table>
    <table align="center" class="invoice-details" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th colspan="4" align="left">Sales Order # <b>0003198361</b></th>
      </tr></thead>
      <tbody>
        <tr>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Delivery Date</td></tr>
              <tr><td><b>09/17/2026</b></td></tr>
            </tbody></table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Order Total*</td></tr>
              <tr><td style="text-align: left;"><b>$72.57</b></td></tr>
                <tr><td class="label">Email: raven_wolf_1510@yahoo.com</td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody>
    </table>

    <table align="center" class="products-table" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th valign="top">ITEM#</th><th valign="top">ITEM <div>NAME</div></th>
          <th valign="top">BRAND</th><th valign="top">PACK/SIZE</th>
          <th valign="top">PRICE</th><th valign="top">ORDERED</th>
          <th valign="top">CONFIRMED</th><th valign="top">STATUS</th>
      </tr></thead>
      <tbody>
        <tr class="">
          <td valign="top">700086</td>
          <td valign="top">Pasta Spaghetti</td>
          <td valign="top">Barilla</td>
          <td valign="top">2/ 10 LB</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$26.83</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Requested<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">121306</td>
          <td valign="top">Pasta Penne Gluten Free</td>
          <td valign="top">Barilla</td>
          <td valign="top">8/ 12 OZ</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$22.87</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">2</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Requested<br>
                    </div></td>
        </tr>

         <tr><td valign="top" colspan="8">
            *This is your order total without taxes, fees and final weight prices.
          </td></tr>
      </tbody>
    </table>
    <table class="footer" align="center" cellspacing="0" cellpadding="0" width="100%">
        <tbody><tr>
              <td class="footer-text help"><a href="https://example.invalid/h" target="_blank">Need Help?</a></td>
              <td class="footer-text about"><a href="https://example.invalid/a" target="_blank">About Ben E. Keith</a></td>
        </tr></tbody>
    </table>
    <table class="copyright" align="center" cellspacing="0" cellpadding="0">
      <tbody>
        <tr><td><br></td></tr>
        <tr><td align="center" colspan="4">Copyright &#169; 2026 Ben E. Keith Co. All Rights Reserved.</td></tr>
      </tbody>
    </table>
    </td></tr></tbody>
    </table>
    </div>
</body></html>
`;

const BEK_OPERATIONAL_SAME_SO = `
<!DOCTYPE html>
<html><body style="font-family: Open Sans, sans-serif;">
    <div class="container-fluid">
    <table class="display-logo" cellspacing="0" cellpadding="0" align="center" width="100%">
        <tbody align="left"><tr><td>
      <table align="center" class="header-title" cellspacing="0" cellpadding="0">
        <tbody><tr><td style="color: #494949;font-size: 26px;font-weight: bold;">
              Your order is confirmed and ready for delivery
        </td></tr></tbody>
      </table>
    <table align="center" class="invoice-details" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th colspan="4" align="left">Sales Order # <b>0003126637</b></th>
      </tr></thead>
      <tbody>
        <tr>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Delivery Date</td></tr>
              <tr><td><b>09/17/2026</b></td></tr>
            </tbody></table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Order Total*</td></tr>
              <tr><td style="text-align: left;"><b>$312.86</b></td></tr>
                <tr><td class="label">Email: raven_wolf_1510@yahoo.com</td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody>
    </table>

    <table align="center" class="products-table" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th valign="top">ITEM#</th><th valign="top">ITEM <div>NAME</div></th>
          <th valign="top">BRAND</th><th valign="top">PACK/SIZE</th>
          <th valign="top">PRICE</th><th valign="top">ORDERED</th>
          <th valign="top">CONFIRMED</th><th valign="top">STATUS</th>
      </tr></thead>
      <tbody>
        <tr class="">
          <td valign="top">145832</td>
          <td valign="top">Ice Cube Sphere Round</td>
          <td valign="top">Vault Ice</td>
          <td valign="top">15/ 5 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$66.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">1</td>
          <td valign="top"><div class="status-val">Filled<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">860055</td>
          <td valign="top">Lid Plas 16sl Trans Slotted</td>
          <td valign="top">Dart</td>
          <td valign="top">10/ 100 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$31.07</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">1</td>
          <td valign="top"><div class="status-val">Filled<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">115846</td>
          <td valign="top">Toilet Tissue 2 Ply White Iw</td>
          <td valign="top">Essentials</td>
          <td valign="top">80/ 550 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$61.79</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">1</td>
          <td valign="top"><div class="status-val">Filled<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">887056</td>
          <td valign="top">Detergent Speed Clean</td>
          <td valign="top">Essentials</td>
          <td valign="top">1/ 5 GAL</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$154.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">1</td>
          <td valign="top"><div class="status-val">Filled<br>
                    </div></td>
        </tr>

         <tr><td valign="top" colspan="8">
            *This is your order total without taxes, fees and final weight prices.
          </td></tr>
      </tbody>
    </table>
    <table class="footer" align="center" cellspacing="0" cellpadding="0" width="100%">
        <tbody><tr>
              <td class="footer-text help"><a href="https://example.invalid/h" target="_blank">Need Help?</a></td>
              <td class="footer-text about"><a href="https://example.invalid/a" target="_blank">About Ben E. Keith</a></td>
        </tr></tbody>
    </table>
    <table class="copyright" align="center" cellspacing="0" cellpadding="0">
      <tbody>
        <tr><td><br></td></tr>
        <tr><td align="center" colspan="4">Copyright &#169; 2026 Ben E. Keith Co. All Rights Reserved.</td></tr>
      </tbody>
    </table>
    </td></tr></tbody>
    </table>
    </div>
</body></html>
`;

const BEK_MIXED_PARTIAL = `
<!DOCTYPE html>
<html><body style="font-family: Open Sans, sans-serif;">
    <div class="container-fluid">
    <table class="display-logo" cellspacing="0" cellpadding="0" align="center" width="100%">
        <tbody align="left"><tr><td>
      <table align="center" class="header-title" cellspacing="0" cellpadding="0">
        <tbody><tr><td style="color: #494949;font-size: 26px;font-weight: bold;">
              Your order is confirmed and ready for delivery
        </td></tr></tbody>
      </table>
    <table align="center" class="invoice-details" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th colspan="4" align="left">Sales Order # <b>0009222333</b></th>
      </tr></thead>
      <tbody>
        <tr>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Delivery Date</td></tr>
              <tr><td><b>09/17/2026</b></td></tr>
            </tbody></table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Order Total*</td></tr>
              <tr><td style="text-align: left;"><b>$55.00</b></td></tr>
                <tr><td class="label">Email: raven_wolf_1510@yahoo.com</td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody>
    </table>

    <table align="center" class="products-table" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th valign="top">ITEM#</th><th valign="top">ITEM <div>NAME</div></th>
          <th valign="top">BRAND</th><th valign="top">PACK/SIZE</th>
          <th valign="top">PRICE</th><th valign="top">ORDERED</th>
          <th valign="top">CONFIRMED</th><th valign="top">STATUS</th>
      </tr></thead>
      <tbody>
        <tr class="">
          <td valign="top">111111</td>
          <td valign="top">Item A Partial</td>
          <td valign="top">BrandA</td>
          <td valign="top">1/ 1 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$10.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">3</td>
          <td valign="top" class="text-right">2</td>
          <td valign="top"><div class="status-val">Filled<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">222222</td>
          <td valign="top">Item B Not Filled</td>
          <td valign="top">BrandB</td>
          <td valign="top">1/ 1 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$25.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Not Filled<br>
                    </div></td>
        </tr>

         <tr><td valign="top" colspan="8">
            *This is your order total without taxes, fees and final weight prices.
          </td></tr>
      </tbody>
    </table>
    <table class="footer" align="center" cellspacing="0" cellpadding="0" width="100%">
        <tbody><tr>
              <td class="footer-text help"><a href="https://example.invalid/h" target="_blank">Need Help?</a></td>
              <td class="footer-text about"><a href="https://example.invalid/a" target="_blank">About Ben E. Keith</a></td>
        </tr></tbody>
    </table>
    <table class="copyright" align="center" cellspacing="0" cellpadding="0">
      <tbody>
        <tr><td><br></td></tr>
        <tr><td align="center" colspan="4">Copyright &#169; 2026 Ben E. Keith Co. All Rights Reserved.</td></tr>
      </tbody>
    </table>
    </td></tr></tbody>
    </table>
    </div>
</body></html>
`;

const BEK_AMBIGUOUS_CANCELLED = `
<!DOCTYPE html>
<html><body style="font-family: Open Sans, sans-serif;">
    <div class="container-fluid">
    <table class="display-logo" cellspacing="0" cellpadding="0" align="center" width="100%">
        <tbody align="left"><tr><td>
      <table align="center" class="header-title" cellspacing="0" cellpadding="0">
        <tbody><tr><td style="color: #494949;font-size: 26px;font-weight: bold;">
              Your order is confirmed and ready for delivery
        </td></tr></tbody>
      </table>
    <table align="center" class="invoice-details" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th colspan="4" align="left">Sales Order # <b>0009444555</b></th>
      </tr></thead>
      <tbody>
        <tr>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Delivery Date</td></tr>
              <tr><td><b>09/17/2026</b></td></tr>
            </tbody></table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Order Total*</td></tr>
              <tr><td style="text-align: left;"><b>$20.00</b></td></tr>
                <tr><td class="label">Email: raven_wolf_1510@yahoo.com</td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody>
    </table>

    <table align="center" class="products-table" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th valign="top">ITEM#</th><th valign="top">ITEM <div>NAME</div></th>
          <th valign="top">BRAND</th><th valign="top">PACK/SIZE</th>
          <th valign="top">PRICE</th><th valign="top">ORDERED</th>
          <th valign="top">CONFIRMED</th><th valign="top">STATUS</th>
      </tr></thead>
      <tbody>
        <tr class="">
          <td valign="top">333333</td>
          <td valign="top">Item Cancelled</td>
          <td valign="top">BrandC</td>
          <td valign="top">1/ 1 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$12.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Cancelled<br>
                    </div></td>
        </tr>
        <tr class="">
          <td valign="top">444444</td>
          <td valign="top">Item Cancelled Two</td>
          <td valign="top">BrandD</td>
          <td valign="top">1/ 1 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$8.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">1</td>
          <td valign="top" class="text-right">0</td>
          <td valign="top"><div class="status-val">Cancelled<br>
                    </div></td>
        </tr>

         <tr><td valign="top" colspan="8">
            *This is your order total without taxes, fees and final weight prices.
          </td></tr>
      </tbody>
    </table>
    <table class="footer" align="center" cellspacing="0" cellpadding="0" width="100%">
        <tbody><tr>
              <td class="footer-text help"><a href="https://example.invalid/h" target="_blank">Need Help?</a></td>
              <td class="footer-text about"><a href="https://example.invalid/a" target="_blank">About Ben E. Keith</a></td>
        </tr></tbody>
    </table>
    <table class="copyright" align="center" cellspacing="0" cellpadding="0">
      <tbody>
        <tr><td><br></td></tr>
        <tr><td align="center" colspan="4">Copyright &#169; 2026 Ben E. Keith Co. All Rights Reserved.</td></tr>
      </tbody>
    </table>
    </td></tr></tbody>
    </table>
    </div>
</body></html>
`;

const BEK_SHORT_FILL_CASE_D = `
<!DOCTYPE html>
<html><body style="font-family: Open Sans, sans-serif;">
    <div class="container-fluid">
    <table class="display-logo" cellspacing="0" cellpadding="0" align="center" width="100%">
        <tbody align="left"><tr><td>
      <table align="center" class="header-title" cellspacing="0" cellpadding="0">
        <tbody><tr><td style="color: #494949;font-size: 26px;font-weight: bold;">
              Your order is confirmed and ready for delivery
        </td></tr></tbody>
      </table>
    <table align="center" class="invoice-details" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th colspan="4" align="left">Sales Order # <b>0009555666</b></th>
      </tr></thead>
      <tbody>
        <tr>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Delivery Date</td></tr>
              <tr><td><b>09/17/2026</b></td></tr>
            </tbody></table>
          </td>
          <td class="cell-wrapper" valign="top">
            <table><tbody>
              <tr><td class="label">Order Total*</td></tr>
              <tr><td style="text-align: left;"><b>$30.00</b></td></tr>
                <tr><td class="label">Email: raven_wolf_1510@yahoo.com</td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody>
    </table>

    <table align="center" class="products-table" cellspacing="0" cellpadding="0">
      <thead><tr>
          <th valign="top">ITEM#</th><th valign="top">ITEM <div>NAME</div></th>
          <th valign="top">BRAND</th><th valign="top">PACK/SIZE</th>
          <th valign="top">PRICE</th><th valign="top">ORDERED</th>
          <th valign="top">CONFIRMED</th><th valign="top">STATUS</th>
      </tr></thead>
      <tbody>
        <tr class="">
          <td valign="top">555555</td>
          <td valign="top">Single Short Item</td>
          <td valign="top">BrandE</td>
          <td valign="top">1/ 1 CT</td>
          <td valign="top" class="text-right price">
            <table align="right" cellspacing="0" cellpadding="0">
              <tbody>
                <tr><td style="border: none;">$10.00</td></tr>
                <tr><td style="border: none;">per case</td></tr>
              </tbody>
            </table>
          </td>
          <td valign="top" class="text-right">3</td>
          <td valign="top" class="text-right">2</td>
          <td valign="top"><div class="status-val">Filled<br>
                    </div></td>
        </tr>

         <tr><td valign="top" colspan="8">
            *This is your order total without taxes, fees and final weight prices.
          </td></tr>
      </tbody>
    </table>
    <table class="footer" align="center" cellspacing="0" cellpadding="0" width="100%">
        <tbody><tr>
              <td class="footer-text help"><a href="https://example.invalid/h" target="_blank">Need Help?</a></td>
              <td class="footer-text about"><a href="https://example.invalid/a" target="_blank">About Ben E. Keith</a></td>
        </tr></tbody>
    </table>
    <table class="copyright" align="center" cellspacing="0" cellpadding="0">
      <tbody>
        <tr><td><br></td></tr>
        <tr><td align="center" colspan="4">Copyright &#169; 2026 Ben E. Keith Co. All Rights Reserved.</td></tr>
      </tbody>
    </table>
    </td></tr></tbody>
    </table>
    </div>
</body></html>
`;

module.exports.BEK_ACKNOWLEDGEMENT       = BEK_ACKNOWLEDGEMENT;
module.exports.BEK_ACK_MISLEADING_HEADER = BEK_ACK_MISLEADING_HEADER;
module.exports.BEK_OPERATIONAL_SAME_SO   = BEK_OPERATIONAL_SAME_SO;
module.exports.BEK_MIXED_PARTIAL         = BEK_MIXED_PARTIAL;
module.exports.BEK_AMBIGUOUS_CANCELLED   = BEK_AMBIGUOUS_CANCELLED;
module.exports.BEK_SHORT_FILL_CASE_D     = BEK_SHORT_FILL_CASE_D;
