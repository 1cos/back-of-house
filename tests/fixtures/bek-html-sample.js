'use strict';
// Fixture HTML minimale ma realistica, basata sul formato osservato nel vero
// MIME/HTML dell'email di produzione (Task 11E: preambolo, valori in <b>,
// tabella articoli con header + righe dati). Nessun dato reale/production,
// solo dati rappresentativi come richiesto dal task.

const BEK_HTML_FIXTURE = `
<html>
<body>
<p> Please do not reply to this message. If you need assistance, please contact your sales representative or visit the Contact Us page.</p>
<p>Your order is confirmed and ready for delivery</p>
<p>Sales Order # <b>0002952908</b></p>
<p>Customer Name <b>ZENO&apos;S ON THE SQUARE</b></p>
<p>Customer# <b>FDF770366</b></p>
<p>Delivery Date <b>08/20/2026</b></p>
<p>Order Total* <b>$81.96</b></p>
<table>
<thead>
<tr><th>ITEM#</th><th>ITEM NAME</th><th>BRAND</th><th>PACK/SIZE</th><th>PRICE</th><th>ORDERED</th><th>CONFIRMED</th><th>STATUS</th></tr>
</thead>
<tbody>
<tr>
<td>116533</td>
<td>Pastry Bag 21in Clr Disposable</td>
<td>Regency Wraps</td>
<td>1/ 100 CT</td>
<td>
  <table>
    <tr><td>$40.98</td></tr>
    <tr><td>per case</td></tr>
  </table>
</td>
<td>2</td>
<td>2</td>
<td>Filled</td>
</tr>
<tr>
<td>118842</td>
<td>Foil Wrap 18in Heavy Duty</td>
<td>Reynolds</td>
<td>1/ 1000 FT</td>
<td>
  <table>
    <tr><td>$12.50</td></tr>
    <tr><td>per case</td></tr>
  </table>
</td>
<td>3</td>
<td>2</td>
<td>Backordered</td>
</tr>
</tbody>
</table>
<p>*This is your order total without taxes, fees and final weight prices.</p>
<p>Copyright &copy; 2026 Ben E. Keith Co. All Rights Reserved.</p>
</body>
</html>
`;

// Fixture minimale per T4: label "Order Total" SENZA asterisco — deve
// continuare a funzionare esattamente come prima del fix.
const BEK_HTML_TOTAL_NO_ASTERISK = `
<html><body>
<p>Ben E. Keith Foods</p>
<p>Sales Order # <b>0002952908</b></p>
<p>Order Total <b>$81.96</b></p>
</body></html>
`;

const SUBJECT = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0002952908";
const FROM = 'CRP-SVCMBX-entree@benekeith.com';

module.exports = { BEK_HTML_FIXTURE, BEK_HTML_TOTAL_NO_ASTERISK, SUBJECT, FROM };
