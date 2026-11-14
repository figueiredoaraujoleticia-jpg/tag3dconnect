// Função de servidor (Vercel) que cria o pagamento no Mercado Pago (Checkout Pro pela API de Orders).
// O Access Token NUNCA fica no site: configure a variável de ambiente MP_ACCESS_TOKEN na hospedagem.
// Os preços e o frete são recalculados aqui, para ninguém alterar o valor pelo navegador.

const PRECO = 67.90;
const CORES = { preto: "Preto", branco: "Branco", vinho: "Vinho", laranja: "Laranja" };
const FRETE = {
  DF: { pac: 15.90, sedex: 19.90 }, CO: { pac: 21.90, sedex: 34.90 }, SE: { pac: 24.90, sedex: 42.90 },
  S: { pac: 27.90, sedex: 49.90 }, NE: { pac: 27.90, sedex: 52.90 }, N: { pac: 32.90, sedex: 64.90 }
};
const REGIAO = { DF:"DF", GO:"CO", MT:"CO", MS:"CO", TO:"N", SP:"SE", RJ:"SE", ES:"SE", MG:"SE", PR:"S", SC:"S", RS:"S",
  BA:"NE", SE:"NE", PE:"NE", AL:"NE", PB:"NE", RN:"NE", CE:"NE", PI:"NE", MA:"NE", PA:"N", AP:"N", AM:"N", RR:"N", AC:"N", RO:"N" };
const CEP_UF = [[1000,19999,"SP"],[20000,28999,"RJ"],[29000,29999,"ES"],[30000,39999,"MG"],[40000,48999,"BA"],[49000,49999,"SE"],
  [50000,56999,"PE"],[57000,57999,"AL"],[58000,58999,"PB"],[59000,59999,"RN"],[60000,63999,"CE"],[64000,64999,"PI"],[65000,65999,"MA"],
  [66000,68899,"PA"],[68900,68999,"AP"],[69000,69299,"AM"],[69300,69399,"RR"],[69400,69899,"AM"],[69900,69999,"AC"],
  [70000,72799,"DF"],[72800,72999,"GO"],[73000,73699,"DF"],[73700,76799,"GO"],[76800,76999,"RO"],[77000,77999,"TO"],
  [78000,78899,"MT"],[79000,79999,"MS"],[80000,87999,"PR"],[88000,89999,"SC"],[90000,99999,"RS"]];

function uf(cep) {
  const d = String(cep || "").replace(/\D/g, "");
  if (d.length !== 8) return null;
  const n = parseInt(d.slice(0, 5), 10);
  const r = CEP_UF.find(([a, b]) => n >= a && n <= b);
  return r ? r[2] : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ erro: "MP_ACCESS_TOKEN não configurado" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const itens = Object.entries(body.itens || {})
    .filter(([cor, q]) => CORES[cor] && Number.isInteger(q) && q > 0 && q <= 50)
    .map(([cor, q]) => ({ id: cor, title: "Chaveiro empresarial " + CORES[cor] + " com tag NFC", quantity: q, unit_price: PRECO.toFixed(2) }));
  const destino = uf(body.cep);
  if (!itens.length || !destino) return res.status(400).json({ erro: "Carrinho ou CEP inválido" });

  const unidades = itens.reduce((s, i) => s + i.quantity, 0);
  const modo = body.frete === "sedex" ? "sedex" : "pac";
  const frete = +(FRETE[REGIAO[destino]][modo] + Math.max(0, unidades - 1) * 1.5).toFixed(2);
  itens.push({ id: "frete", title: "Frete " + modo.toUpperCase() + " (Correios)", quantity: 1, unit_price: frete.toFixed(2) });
  const total = itens.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0).toFixed(2);

  const site = "https://" + req.headers.host;
  const pedido = "T3D-" + Date.now();
  const r = await fetch("https://api.mercadopago.com/v1/orders", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "X-Idempotency-Key": pedido },
    body: JSON.stringify({
      type: "online",
      processing_mode: "manual",
      total_amount: total,
      external_reference: pedido,
      description: "Pedido Tag 3D.connect",
      items: itens.map(({ title, quantity, unit_price }) => ({ title, quantity, unit_price })),
      config: {
        online: {
          success_url: site + "/?pagamento=aprovado",
          pending_url: site + "/?pagamento=pendente",
          failure_url: site + "/?pagamento=recusado",
          auto_return: "approved"
        },
        payment_method: { max_installments: 12, not_allowed_types: ["ticket"] }
      }
    })
  });
  const data = await r.json();
  if (!r.ok) return res.status(502).json({ erro: "Mercado Pago recusou", detalhe: data.message || data.errors });
  // Dados de entrega e links dos chaveiros ficam nos logs da Vercel, ligados ao número do pedido.
  console.log("PEDIDO", pedido, JSON.stringify({ comprador: body.comprador, cep: body.cep, frete: modo, links: body.links }));
  const url = data.checkout_url || (data.config && data.config.online && data.config.online.checkout_url);
  if (!url) return res.status(502).json({ erro: "Resposta sem checkout_url" });
  return res.status(200).json({ url, pedido });
};
