import React, { useEffect, useState, useCallback, useLayoutEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, ScrollView, Animated, Linking, Image, Modal, Pressable, TextInput, Alert, RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import IconActionButton from '../components/IconActionButton';

import { RootStackParamList } from '../../App';

const FUND_GLOSSARY: Record<string, { title: string; desc: string }> = {
  'Market Cap': { title: 'Market Cap', desc: 'Valor total de mercado da empresa: preço da ação × número de ações em circulação.\n\nIndica a "dimensão" da empresa aos olhos do mercado:\n• < $2B → Small Cap\n• $2B–$10B → Mid Cap\n• > $10B → Large Cap\n\nExemplo: Apple a $175/ação com 15,4B ações = Market Cap de ~$2,7T.' },
  'P/E (trailing)': { title: 'P/E Trailing', desc: 'Preço da ação ÷ Lucro por ação (EPS) dos últimos 12 meses reais.\n\nResponde à pergunta: "Quanto estou a pagar por €1 de lucro?"\n\nExemplo: Ação a $100, EPS = $5 → P/E = 20×. Significa que pagas 20 anos de lucros pelo preço atual.\n\nReferência:\n• S&P 500 histórico ≈ 15–18×\n• Tecnologia costuma ter P/E > 25×\n• Utilities e bancos costumam ter P/E < 15×\n\nP/E alto ≠ caro automaticamente — pode refletir crescimento esperado.' },
  'P/E (forward)': { title: 'P/E Forward', desc: 'Preço da ação ÷ Lucro por ação estimado para os próximos 12 meses (previsões de analistas).\n\nSe o P/E forward for muito inferior ao trailing, os analistas esperam crescimento de lucros.\n\nExemplo: Ação a $100, EPS estimado = $6 → P/E forward = 16,7×\nSe trailing era 20×, o mercado desconta crescimento de ~20% no lucro.\n\nAtenção: baseia-se em estimativas que podem estar erradas.' },
  'P/B (Price/Book)': { title: 'Price-to-Book (P/B)', desc: 'Preço de mercado ÷ Valor contabilístico por ação (ativos − passivos).\n\nResposta à pergunta: "Quanto pago face ao valor líquido dos ativos?"\n\nExemplo: Ação a $50, book value = $25 → P/B = 2×.\nEstás a pagar o dobro do valor registado nos livros.\n\nReferência:\n• P/B < 1 → pode estar subvalorizada (ou em dificuldades)\n• Bancos e seguradoras: P/B ≈ 1–2× é normal\n• Tecnologia: P/B > 10× é comum (ativos intangíveis não contam no book)' },
  'P/S (Price/Sales)': { title: 'Price-to-Sales (P/S)', desc: 'Capitalização de mercado ÷ Receita anual total.\n\nÚtil para empresas sem lucros (startups, crescimento acelerado) onde o P/E não existe.\n\nExemplo: Empresa vale $10B em bolsa e tem receita de $2B → P/S = 5×.\nPagas $5 por cada $1 de receita.\n\nReferência:\n• P/S < 1 → potencialmente barata\n• Tech de crescimento: P/S 5–20× é comum\n• O problema: ignora completamente a margem de lucro.' },
  'Enterprise Value': { title: 'Enterprise Value (EV)', desc: 'O "preço completo" de comprar uma empresa:\nEV = Market Cap + Dívida Total − Caixa\n\nExemplo: Empresa com Market Cap $50B, dívida $10B e caixa $5B → EV = $55B.\nSe comprasses a empresa inteira, assumias também a dívida e ficavas com o caixa.\n\nÉ mais preciso que o Market Cap sozinho para comparar empresas com estruturas de capital diferentes.' },
  'EPS (trailing)': { title: 'EPS Trailing', desc: 'Lucro líquido dos últimos 12 meses ÷ número de ações em circulação.\n\nA "linha de fundo" real — quanto lucrou a empresa por cada ação que possuis.\n\nExemplo: Empresa lucrou $20B com 10B ações → EPS = $2,00.\nSe tiveres 50 ações, a empresa lucrou $100 "para ti" no último ano.\n\nCresce o EPS consistentemente = sinal de qualidade.' },
  'EPS (forward)': { title: 'EPS Forward', desc: 'Estimativa de lucro por ação para os próximos 12 meses, calculada pela média das previsões dos analistas.\n\nExemplo: EPS trailing $2,00 → EPS forward $2,40 = analistas esperam crescimento de 20%.\n\nSe o EPS forward for muito superior ao trailing, o mercado já pode ter "precificado" esse crescimento no preço atual. Verifica sempre a fiabilidade histórica das estimativas da empresa.' },
  'Total Revenue': { title: 'Total Revenue', desc: 'O total de dinheiro que entrou na empresa através de vendas e serviços, antes de qualquer custo.\n\nChama-se "top line" porque é a primeira linha da demonstração de resultados.\n\nExemplo: Apple vendeu iPhones, Macs e serviços no valor de $391B num ano → Receita = $391B.\n\nReceita crescente ≠ empresa lucrativa. Uma empresa pode crescer receita e ainda ter prejuízo se os custos crescerem mais.' },
  'EBITDA': { title: 'EBITDA', desc: 'Earnings Before Interest, Taxes, Depreciation & Amortization.\nLucro operacional antes de: juros da dívida, impostos, depreciação de ativos físicos e amortização de intangíveis.\n\nPorquê usar? Remove o efeito de decisões financeiras e contabilísticas, mostrando a rentabilidade "pura" do negócio.\n\nExemplo:\nReceita: $100M\n− Custo operacional: $60M\n= EBITDA: $40M (margem 40%)\n\nMargem EBITDA > 20% é geralmente considerada saudável. Empresas de software costumam ter 30–50%.' },
  'EV/EBITDA': { title: 'EV/EBITDA', desc: 'Enterprise Value ÷ EBITDA. O "P/E melhorado" — inclui a dívida e remove efeitos contabilísticos.\n\nResponde: "Quantos anos de EBITDA pago para comprar a empresa inteira?"\n\nExemplo: EV = $55B, EBITDA = $4B → EV/EBITDA = 13,75×.\nRecuperarias o investimento em ~14 anos só com o EBITDA.\n\nReferência:\n• S&P 500 médio ≈ 13–15×\n• Tecnologia: 20–40×\n• Utilities: 8–12×\n• < 10× pode indicar empresa barata (ou em dificuldades)\n\nIdeal para comparar empresas do mesmo setor.' },
  'Gross Margin': { title: 'Gross Margin', desc: '(Receita − Custo dos Produtos Vendidos) ÷ Receita.\n\nMede o lucro antes de qualquer despesa operacional, administrativa ou de marketing.\n\nExemplo: Receita $100M, custo de produção $40M → Margem bruta = 60%.\n\nReferência:\n• Software / SaaS: 70–90% (custo marginal quase zero)\n• Retalho: 20–40%\n• Manufactura: 15–35%\n\nMargem bruta alta = poder de pricing e vantagem competitiva.' },
  'Operating Margin': { title: 'Operating Margin', desc: 'Lucro operacional (EBIT) ÷ Receita. Rentabilidade após TODOS os custos operacionais (vendas, marketing, I&D, administração) mas antes de juros e impostos.\n\nExemplo:\nReceita: $100M, custos operacionais totais: $75M\n→ Margem operacional = 25%\n\nReferência:\n• Excelente: > 20%\n• Boa: 10–20%\n• Fraca: < 10%\n\nVisa tem margem operacional de ~67% — excecionalmente alta mesmo para o setor financeiro.' },
  'Net Margin': { title: 'Net Margin', desc: 'Lucro líquido ÷ Receita. A "linha de baixo" — de cada €100 de receita, quanto fica para os acionistas depois de TUDO pago (custos, juros, impostos).\n\nExemplo: Receita $100M, lucro líquido $15M → Margem líquida = 15%.\n\nReferência:\n• > 20% → excelente (ex: Visa ~55%, Apple ~25%)\n• 10–20% → boa\n• < 5% → fraca ou setor de baixa margem (retalho, alimentação)\n\nJunto com a receita, define o lucro absoluto.' },
  'Revenue Growth (YoY)': { title: 'Revenue Growth (YoY)', desc: 'Variação percentual da receita face ao ano anterior (Year-over-Year).\n\nExemplo: Receita 2023 = $80M, Receita 2024 = $100M → Crescimento = +25%.\n\nReferência:\n• > 20% → crescimento forte (típico de tech)\n• 5–15% → crescimento sólido e sustentável\n• < 5% → maturidade ou estagnação\n• Negativo → contração preocupante\n\nAnalisar em conjunto com a margem: crescer receita sacrificando margem não é necessariamente bom.' },
  'Earnings Growth (YoY)': { title: 'Earnings Growth (YoY)', desc: 'Variação percentual do lucro líquido face ao ano anterior.\n\nExemplo: Lucro 2023 = $10M, Lucro 2024 = $14M → Crescimento = +40%.\n\nIdealmente o lucro deve crescer mais do que a receita — sinal de alavancagem operacional (escalar sem aumentar custos proporcionalmente).\n\nCrescimento de lucro consistente durante 5–10 anos é um dos melhores indicadores de qualidade de uma empresa.' },
  'ROIC': { title: 'ROIC — Return on Invested Capital', desc: 'Lucro operacional após impostos (NOPAT) ÷ Capital investido.\n\nMede a eficiência com que a empresa gera retorno sobre TODO o capital que nela foi investido (dívida + capital próprio).\n\nFórmula simplificada:\nROIC = NOPAT ÷ (Equity + Dívida líquida)\n\nReferência:\n• > WACC → a empresa cria valor para os acionistas\n• < WACC → a empresa destrói valor\n• > 15% → excelente (Visa ≈ 30%, MSFT ≈ 25%)\n• < 8% → fraco\n\nROIC > WACC de forma consistente é o principal indicador de um negócio de qualidade ("moat").'},
  'WACC': { title: 'WACC — Custo Médio Ponderado do Capital', desc: 'Weighted Average Cost of Capital — a taxa mínima de retorno que a empresa precisa de gerar para satisfazer credores e acionistas.\n\nFórmula:\nWACC = (E/V) × Re + (D/V) × Rd × (1 − T)\n\nOnde:\n• E/V = peso do capital próprio\n• D/V = peso da dívida\n• Re = custo do capital (CAPM)\n• Rd = custo da dívida\n• T = taxa de imposto\n\nReferência:\n• Empresas grandes e estáveis: 7–10%\n• Startups e empresas alavancadas: 12–20%\n\nROIC > WACC = empresa cria valor.\nROIC < WACC = empresa destrói valor mesmo com lucro contabilístico.' },
  'ROE': { title: 'Return on Equity (ROE)', desc: 'Lucro líquido ÷ Capital próprio dos acionistas. Mede quanto a empresa ganha com o dinheiro que os acionistas investiram.\n\nExemplo: Lucro $20M, capital próprio $100M → ROE = 20%.\nPor cada $100 investidos pelos acionistas, a empresa gerou $20 de lucro.\n\nReferência:\n• > 20% → excelente (Visa ≈ 50%+, Apple ≈ 170%+)\n• 15–20% → muito bom\n• < 10% → fraco\n\nAtenção: ROE muito alto pode significar dívida elevada (menos capital próprio no denominador).' },
  'ROA': { title: 'Return on Assets (ROA)', desc: 'Lucro líquido ÷ Total de ativos. Mede a eficiência com que a empresa converte os seus ativos em lucro.\n\nExemplo: Lucro $20M, ativos totais $200M → ROA = 10%.\n\nReferência:\n• > 10% → eficiência alta\n• 5–10% → razoável\n• < 5% → setores intensivos em capital (bancos, utilities têm naturalmente ROA baixo)\n\nMelhor para comparar empresas do mesmo setor com estruturas de capital diferentes.' },
  'Cash & Equivalents': { title: 'Cash & Equivalents', desc: 'Total de dinheiro disponível imediatamente: contas bancárias, títulos de curto prazo, money market funds.\n\nExemplo: Apple tem ~$67B em caixa — pode pagar dividendos, recomprar ações, fazer aquisições ou resistir a crises sem precisar de financiamento externo.\n\nUma "almofada" grande é sinal de solidez financeira, mas caixa excessivo pode indicar falta de oportunidades de investimento (ineficiência de capital).' },
  'Total Debt': { title: 'Total Debt', desc: 'Soma de toda a dívida financeira: empréstimos bancários, obrigações (bonds) e outros instrumentos de dívida de curto e longo prazo.\n\nNão é "má" por si só — dívida barata usada para crescer pode criar valor.\n\nExemplo: Empresa com EBITDA $5B e dívida $10B → Dívida/EBITDA = 2×. Pagaria a dívida em 2 anos com o EBITDA (aceitável).\n\nDívida/EBITDA > 4× começa a ser preocupante na maioria dos setores.' },
  'Debt/Equity': { title: 'Debt/Equity', desc: 'Dívida total ÷ Capital próprio. Mede a alavancagem financeira — quanto da empresa é financiado por dívida vs. capital dos acionistas.\n\nExemplo: Dívida $60M, capital próprio $40M → D/E = 1,5×.\nPor cada $1 de capital próprio, a empresa tem $1,50 de dívida.\n\nReferência:\n• < 0,5 → pouco endividada\n• 0,5–1,5 → moderado\n• > 2 → alavancagem elevada\n\nBancos e utilities têm D/E naturalmente alto. Tecnologia e pharma costumam ter D/E baixo.' },
  'Current Ratio': { title: 'Current Ratio', desc: 'Ativos correntes ÷ Passivos correntes. Mede a capacidade de pagar as obrigações de curto prazo (próximos 12 meses) com os ativos líquidos disponíveis.\n\nExemplo: Ativos correntes $500M, passivos correntes $250M → Rácio = 2×.\nA empresa tem o dobro do necessário para cobrir as suas obrigações imediatas.\n\nReferência:\n• > 2 → boa liquidez\n• 1–2 → aceitável\n• < 1 → pode ter dificuldades a pagar fornecedores ou dívida de curto prazo' },
  'Beta': { title: 'Beta', desc: 'Mede a volatilidade da ação em relação ao mercado (S&P 500 = Beta de 1,0).\n\nExemplos:\n• Beta 1,5 → se o S&P sobe 10%, esta ação tende a subir 15% (e vice-versa)\n• Beta 0,5 → movimentos de metade do mercado (mais defensiva)\n• Beta negativo → move-se inversamente (ex: ouro, algumas utilities)\n\nBeta alto = maior risco mas maior potencial de retorno.\nBeta baixo = mais estabilidade, útil em carteiras defensivas.\n\nAtenção: o Beta é calculado com dados históricos e pode mudar.' },
  '52W High': { title: '52-Week High', desc: 'O preço mais alto atingido pela ação nos últimos 12 meses.\n\nUso prático:\n• Ação perto do máximo 52S → momentum forte, mas pode estar "esticada"\n• Ação 30–50% abaixo do máximo → pode ser oportunidade ou reflexo de problemas reais\n\nPara análise técnica, o máximo 52S funciona como nível de resistência — zona onde historicamente apareceram vendedores. Romper este nível com volume é sinal bullish.' },
  '52W Low': { title: '52-Week Low', desc: 'O preço mais baixo atingido pela ação nos últimos 12 meses.\n\nUso prático:\n• Ação perto do mínimo 52S → pode estar extremamente desvalorizada ou em queda livre\n• Serve como suporte técnico — zona onde historicamente apareceram compradores\n\nComparar com o máximo dá a amplitude de variação:\nEx: mínimo $80, máximo $140 → amplitude de 75%. Ação volátil.' },
  'Avg. Volume': { title: 'Avg. Daily Volume', desc: 'Média de ações transacionadas por dia nos últimos 30–90 dias.\n\nPorquê importa?\n→ Liquidez: volume alto = fácil comprar e vender sem mover o preço.\n→ Confiança: aumento de volume numa direção confirma a tendência.\n\nExemplo:\n• Apple: ~60M ações/dia — podes comprar ou vender sem impacto\n• Small cap com 50K ações/dia — uma ordem grande pode mover bruscamente o preço\n\nVolume muito baixo = spread bid-ask mais largo = mais caro negociar.' },
  'Dividend Yield': { title: 'Dividend Yield', desc: 'Dividendo anual por ação ÷ Preço atual da ação × 100.\n\nExemplo: Dividendo anual $2,40, ação a $60 → Yield = 4%.\nRecebes 4% do valor investido apenas em dividendos por ano.\n\nReferência:\n• 0–1% → crescimento, empresa reinveste tudo\n• 1–3% → equilibrado (ex: Visa ~0,9%, Apple ~0,5%)\n• 3–5% → rendimento significativo (ex: Coca-Cola ~3%)\n• > 6% → yield muito alto — pode ser sinal de corte iminente do dividendo\n\nSempre comparar com a taxa de juro sem risco.' },
  'Payout Ratio': { title: 'Payout Ratio', desc: 'Percentagem do lucro líquido distribuída como dividendo.\nPayout = (Dividendo por ação ÷ EPS) × 100\n\nExemplo: EPS $5, dividendo $1,50 → Payout = 30%.\nA empresa distribui 30% do lucro e reinveste os outros 70%.\n\nReferência:\n• < 30% → dividendo conservador, muito espaço para crescer\n• 30–60% → equilibrado e sustentável\n• 60–80% → elevado, menos margem de segurança\n• > 100% → empresa paga mais do que ganha (insustentável a longo prazo)\n\nEmpresas de crescimento têm payout baixo; utilities e REITs costumam ter payout > 70%.' },
  'Price Gain': { title: 'Price Gain', desc: 'O lucro ou perda gerado exclusivamente pela variação do preço da ação desde o teu preço médio de compra.\n\nCálculo: (Preço Atual − Preço Médio) × Nº de Ações\n\nNão inclui dividendos recebidos. Reflete apenas a valorização (ou desvalorização) do preço da tua posição.' },
  'Total Return': { title: 'Total Return', desc: 'O retorno total do teu investimento, combinando a valorização do preço com os dividendos recebidos.\n\nFórmula:\nTotal Return = Price Gain + Dividendos Recebidos\nTotal Return % = Total Return ÷ Custo Total × 100\n\nÉ a medida mais completa da performance do teu investimento, pois os dividendos são rendimento real em dinheiro e devem ser somados à valorização do preço.' },
  // Financials tab — Income Statement
  'Revenue': { title: 'Revenue (Receita)', desc: 'Total de dinheiro que entrou na empresa através de vendas e serviços, antes de qualquer custo. A "top line" da demonstração de resultados.\n\nCresce a receita com margem estável ou crescente = sinal saudável.' },
  'Cost of Revenue': { title: 'Cost of Revenue (CPV)', desc: 'Custo direto de produzir o que a empresa vende (matérias-primas, mão de obra direta, etc.).\n\nReceita − CPV = Gross Profit. CPV a crescer mais rápido que a receita significa perda de margem bruta.' },
  'Gross Profit': { title: 'Gross Profit (Lucro Bruto)', desc: 'Receita − Custo dos Produtos Vendidos.\n\nPonto de partida da análise de rentabilidade. Software tem gross profit alto (70–90%) porque o custo marginal por unidade é quase zero.' },
  'R&D': { title: 'R&D — Investigação & Desenvolvimento', desc: 'Despesas com pesquisa e desenvolvimento de novos produtos.\n\nInvestimento consistente em I&D constrói vantagens competitivas futuras.\n\nReferência:\n• Big Tech: 8–20% da receita\n• Biofarma: 15–25%\n• Retalho: < 1%' },
  'SG&A': { title: 'SG&A — Selling, General & Administrative', desc: 'Despesas de vendas, marketing e administração geral.\n\nEmpresa eficiente cresce receita sem crescer SG&A proporcionalmente — isso chama-se alavancagem operacional.' },
  'Operating Income': { title: 'Operating Income (EBIT)', desc: 'Lucro antes de juros e impostos — resultado da atividade operacional pura.\n\nReceita − CPV − R&D − SG&A = Operating Income.\n\nMede a rentabilidade do negócio independentemente de como é financiado.' },
  'Op. Margin': { title: 'Operating Margin (Margem Operacional)', desc: 'Operating Income ÷ Revenue.\n\nReferência:\n• Excelente: > 25%\n• Boa: 15–25%\n• Média: 8–15%\n• Fraca: < 8%\n\nVisa ~67%, Apple ~31%, Amazon ~6%.' },
  'EBITDA Margin': { title: 'EBITDA Margin', desc: 'EBITDA ÷ Revenue.\n\nMais comparável entre empresas que a margem operacional porque elimina diferenças de políticas de depreciação.\n\nReferência:\n• Software: 25–45%\n• Tech hardware: 20–35%\n• Retalho: 5–15%' },
  'Interest Expense': { title: 'Interest Expense (Juros)', desc: 'Custo dos juros pagos sobre a dívida financeira.\n\nInterest Coverage = EBIT ÷ Interest Expense:\n• > 5× → confortável\n• 2–5× → aceitável\n• < 2× → risco financeiro\n\nApple e muitas tech têm interest expense ≈ 0 porque a caixa gera mais juros do que a dívida custa.' },
  'Pre-tax Income': { title: 'Pre-tax Income (EBT)', desc: 'Lucro antes de impostos: Operating Income ± ganhos/perdas financeiras não operacionais.\n\nA diferença entre Operating Income e EBT revela o impacto da estrutura de capital.' },
  'Income Tax': { title: 'Income Tax (Imposto sobre o Rendimento)', desc: 'Impostos pagos sobre o lucro.\n\nTaxa efetiva = Income Tax ÷ Pre-tax Income — costuma ser inferior à taxa nominal por créditos fiscais de I&D e operações internacionais.' },
  'Net Income': { title: 'Net Income (Lucro Líquido)', desc: 'O resultado final — o que sobra para os acionistas depois de todos os custos, juros e impostos.\n\nA "bottom line". Crescimento consistente ao longo dos anos é um dos indicadores mais importantes de qualidade empresarial.' },
  'SBC': { title: 'SBC — Stock-Based Compensation', desc: 'Compensação paga a funcionários em ações da empresa em vez de dinheiro.\n\nNão é um custo de caixa mas dilui os acionistas existentes.\n\nSBC/Revenue:\n• < 3% → razoável\n• > 8% → dilutivo e preocupante\n\nApple ~3% | Nvidia ~2% | Salesforce ~8%' },
  'EPS (Diluted)': { title: 'EPS Diluted (Lucro por Ação Diluído)', desc: 'Net Income ÷ número total de ações diluídas (incluindo opções e convertíveis).\n\nO EPS diluted é mais conservador que o básico porque conta com todas as ações que podem vir a existir.' },
  'Shares (Diluted)': { title: 'Diluted Shares Outstanding', desc: 'Número total de ações em circulação + todas as potenciais ações de opções, warrants e convertíveis.\n\nQuando diminui = empresa está a fazer buybacks (positivo).\nQuando cresce = diluição (negativo se por SBC excessivo).\n\nApple: de ~21B ações em 2012 para ~15B em 2025 via buybacks.' },
  // Financials tab — Balance Sheet
  'Cash & Equiv.': { title: 'Cash & Equivalents', desc: 'Dinheiro disponível imediatamente e investimentos com vencimento < 90 dias.\n\nUma boa almofada de caixa dá flexibilidade para aquisições, buybacks e resistir a crises sem recorrer a financiamento externo.' },
  'Cash + ST Invest.': { title: 'Cash + Short-Term Investments', desc: 'Caixa + investimentos de curto prazo (obrigações de curto prazo, fundos monetários).\n\nMedida mais completa de liquidez. Empresas como a Apple investem grande parte da caixa em títulos de curto prazo.\n\nApple FY2024: Cash $30B + ST Invest. $35B = $65B de liquidez total.' },
  'Current Assets': { title: 'Current Assets (Ativos Correntes)', desc: 'Ativos que se convertem em dinheiro em menos de 12 meses: caixa, inventário, contas a receber.\n\nCurrent Ratio = Current Assets ÷ Current Liabilities.\nRatio > 1 → a empresa consegue pagar as obrigações de curto prazo.' },
  'Total Assets': { title: 'Total Assets (Total de Ativos)', desc: 'Soma de todos os ativos: correntes + não correntes (instalações, equipamento, intangíveis, goodwill).\n\nAtivos = Passivos + Capital Próprio (equação contabilística fundamental).' },
  'Current Liabilities': { title: 'Current Liabilities (Passivos Correntes)', desc: 'Obrigações a pagar nos próximos 12 meses: fornecedores, dívida de curto prazo, impostos a pagar.\n\nSe Current Liabilities > Current Assets → possível dificuldade de liquidez de curto prazo.' },
  'Short-term Debt': { title: 'Short-term Debt (Dívida de Curto Prazo)', desc: 'Dívida com vencimento nos próximos 12 meses: papel comercial, linhas de crédito, porção corrente da dívida de longo prazo.\n\nSe a empresa não tiver caixa suficiente para refinanciar, pode ser um risco.' },
  'Long-term Debt': { title: 'Long-term Debt (Dívida de Longo Prazo)', desc: 'Dívida com vencimento superior a 12 meses: obrigações, empréstimos bancários.\n\nDívida/EBITDA:\n• < 2× → confortável\n• 2–4× → elevado mas gerível\n• > 4× → arriscado na maioria dos sectores' },
  'Net Debt': { title: 'Net Debt (Dívida Líquida)', desc: 'Total Debt − Cash & Equivalents.\n\nValor negativo = net cash position (mais caixa do que dívida — Apple, Microsoft).\n\nUsado em EV = Market Cap + Net Debt para calcular o valor real da empresa para um comprador total.' },
  'Total Liabilities': { title: 'Total Liabilities (Total de Passivos)', desc: 'Soma de todas as obrigações da empresa.\n\nAtivos − Passivos = Capital Próprio.\n\nPassivos > Ativos = equity negativo. Normal em empresas com buybacks muito agressivos (Apple, McDonald\'s) se têm forte geração de caixa.' },
  'Equity': { title: 'Equity (Capital Próprio)', desc: 'O valor contabilístico que pertence aos acionistas: Ativos − Passivos.\n\nEquity = Common Stock + Retained Earnings.\n\nEmpresas com buybacks agressivos podem ter Equity negativo — matematicamente consistente mas só aceitável com FCF muito forte.' },
  'Retained Earnings': { title: 'Retained Earnings (Resultados Retidos)', desc: 'Lucros acumulados ao longo da história da empresa não distribuídos como dividendos.\n\nCrescentes = empresa reinveste e cria valor.\nNegativos = distribuiu mais do que lucrou, ou fez buybacks massivos (Apple tem retained earnings negativos por isso).' },
  'Goodwill': { title: 'Goodwill', desc: 'O prémio pago em aquisições acima do justo valor dos ativos líquidos adquiridos — representa marcas, talento e sinergias esperadas.\n\nMicrosoft pagou $68.7B pela Activision; o goodwill registado foi ~$63B.\n\nImpairment de goodwill = aquisição sobrestimada → destruição de valor.' },
  // Financials tab — Cash Flow
  'Operating CF': { title: 'Operating Cash Flow (FCO)', desc: 'Dinheiro gerado pela atividade operacional do negócio.\n\nDiferente do Net Income porque adiciona despesas não-cash (D&A, SBC) e ajusta variações de working capital.\n\nOperating CF > Net Income = boa qualidade dos lucros.\nOperating CF consistentemente abaixo do Net Income = lucros têm muita componente contabilística.' },
  'Capital Expenditure': { title: 'Capital Expenditure (Capex)', desc: 'Investimento em ativos fixos: fábricas, equipamento, infraestrutura.\n\nCapex de manutenção: mantém o negócio funcionando.\nCapex de crescimento: investe na expansão futura.\n\nEmpresas de software têm Capex baixo → FCF ≈ Operating CF.' },
  'Free Cash Flow': { title: 'Free Cash Flow (FCF)', desc: 'Operating Cash Flow − Capital Expenditure.\n\nO dinheiro real disponível para distribuir (dividendos, buybacks) ou fazer aquisições.\n\nP/FCF típico para empresas de qualidade: 20–30×.\nFCF Yield = FCF ÷ Market Cap: > 4% começa a ser interessante.' },
  'FCF Margin': { title: 'FCF Margin (Margem de Free Cash Flow)', desc: 'Free Cash Flow ÷ Revenue.\n\nReferência:\n• > 25% → excelente (Apple ~28%, Visa ~50%)\n• 15–25% → muito boa\n• 5–15% → razoável\n• < 5% → baixa (negócios intensivos em capital)\n\nMargem FCF crescente = empresa torna-se progressivamente mais eficiente.' },
  'D&A': { title: 'D&A — Depreciation & Amortization', desc: 'Depreciação de ativos físicos + Amortização de intangíveis.\n\nNão é um custo em dinheiro — é um ajuste contabilístico. Por isso é somado de volta no Operating CF:\n\nOperating CF = Net Income + D&A + SBC + Δ working capital\n\nEmpresas intensivas em capital têm D&A elevado.' },
  'Buybacks': { title: 'Share Buybacks (Recompra de Ações)', desc: 'Dinheiro gasto pela empresa a recomprar as suas próprias ações.\n\nEfeito: reduz o número de ações → cada ação representa uma fatia maior da empresa → EPS sobe automaticamente.\n\nÉ mais eficiente que dividendos em termos fiscais para os acionistas.\n\nApple: +$90B/ano — em 12 anos recomprou >30% das suas próprias ações.' },
  'Dividends Paid': { title: 'Dividends Paid (Dividendos Pagos)', desc: 'Total de dividendos distribuídos em dinheiro durante o período.\n\nPayout Ratio = Dividends Paid ÷ Net Income.\n\nSustentabilidade: Dividends Paid < FCF → sustentável; Dividends Paid > FCF → empresa financia dividendos com dívida.' },
  'Investing CF': { title: 'Investing Cash Flow', desc: 'Cash das atividades de investimento: compra/venda de ativos, aquisições, investimentos financeiros.\n\nNormalmente negativo. Menos negativo ao longo do tempo pode significar menos capex (positivo) ou desinvestimento.\n\nGrandes aquisições aparecem aqui como saídas massivas de caixa.' },
  'Financing CF': { title: 'Financing Cash Flow', desc: 'Cash das atividades de financiamento: emissão/recompra de ações, emissão/pagamento de dívida, dividendos.\n\nNormalmente negativo em empresas maduras que fazem buybacks e pagam dividendos.\n\nPositivo = empresa está a levantar capital externo.' },
  // ETF-specific
  'TER (expense ratio)': { title: 'TER — Total Expense Ratio', desc: 'A taxa de gestão anual cobrada pelo fundo, expressa como percentagem dos ativos sob gestão (AUM).\n\nEstá incluída no preço do ETF — não é cobrada separadamente. Reduz o retorno anual do fundo proporcionalmente.\n\nExemplo: ETF com TER 0,07% → por cada €10.000 investidos, pagas €7/ano em custos.\n\nReferência:\n• < 0,10% → muito barato (ex: VWCE, VUAA)\n• 0,10–0,30% → razoável\n• > 0,50% → caro (justificável só em estratégias nicho ou gestão ativa)\n\nPreferir sempre o ETF com TER mais baixo para a mesma exposição.' },
  'Fund volume (AUM)': { title: 'AUM — Assets Under Management', desc: 'O total de ativos geridos pelo fundo — soma do valor de mercado de todos os títulos na carteira.\n\nPorquê importa?\n• AUM alto → ETF mais líquido e com spread bid-ask mais baixo\n• AUM baixo → risco de encerramento do fundo (closure risk)\n\nReferência:\n• > €500M → seguro e líquido\n• > €1B → muito estabelecido\n• < €100M → risco de fechar, evitar para posições a longo prazo\n\nETFs de replicação física precisam de AUM suficiente para suportar os custos fixos.' },
  'Issuer': { title: 'Emissor do ETF', desc: 'A gestora de ativos responsável pela criação, gestão e operação do ETF.\n\nPrincipais emissores europeus:\n• Vanguard — fundadora do conceito de investimento passivo de baixo custo\n• iShares (BlackRock) — maior emissor global por AUM\n• Xtrackers (DWS) — forte presença na Europa\n• Amundi — maior gestora europeia\n• SPDR (State Street) — pioneira dos ETFs (lançou o primeiro ETF em 1993)\n\nO emissor não afeta diretamente o retorno (que depende do índice replicado), mas importa para a solidez operacional e custos.' },
  'Inception date': { title: 'Data de lançamento', desc: 'A data em que o ETF foi criado e começou a negociar em bolsa.\n\nPorquê importa?\n• ETFs mais antigos têm histórico de performance real — podes verificar tracking error ao longo do tempo\n• ETFs recentes (< 3 anos) têm menos dados históricos para avaliar a qualidade da replicação\n• ETFs muito novos com AUM baixo têm risco de encerramento antes de atingir escala\n\nGeralmente preferível escolher ETFs com pelo menos 3–5 anos de historial.' },
  'Holdings turnover': { title: 'Holdings Turnover', desc: 'A percentagem da carteira do ETF que é substituída (comprada/vendida) ao longo de um ano.\n\nExemplo: Turnover de 20% → 1/5 da carteira é renovada por ano.\n\nReferência:\n• < 10% → ETF muito passivo, segue índice estável\n• 10–30% → normal para ETFs de índices standard\n• > 50% → elevado — pode indicar estratégia ativa ou índice com muita rotatividade\n\nTurnover alto aumenta os custos de transação internos (não refletidos no TER), reduzindo o retorno real.' },
};

// ---- Market hours lookup ----
const _toMin = (h: number, m: number): number => h * 60 + m;
const minToStr = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

type SessionDef = { type: 'pre' | 'regular' | 'post'; startMin: number; endMin: number };

const EXCHANGE_SESSIONS: Record<string, SessionDef[]> = {
  'America/New_York':  [{ type: 'pre', startMin: _toMin(4,0),   endMin: _toMin(9,30)  }, { type: 'regular', startMin: _toMin(9,30),  endMin: _toMin(16,0)  }, { type: 'post', startMin: _toMin(16,0),  endMin: _toMin(20,0)  }],
  'America/Chicago':   [{ type: 'pre', startMin: _toMin(3,0),   endMin: _toMin(8,30)  }, { type: 'regular', startMin: _toMin(8,30),  endMin: _toMin(15,0)  }, { type: 'post', startMin: _toMin(15,0),  endMin: _toMin(19,0)  }],
  'America/Toronto':   [{ type: 'pre', startMin: _toMin(4,0),   endMin: _toMin(9,30)  }, { type: 'regular', startMin: _toMin(9,30),  endMin: _toMin(16,0)  }, { type: 'post', startMin: _toMin(16,0),  endMin: _toMin(17,0)  }],
  'America/Sao_Paulo': [{ type: 'pre', startMin: _toMin(9,45),  endMin: _toMin(10,0)  }, { type: 'regular', startMin: _toMin(10,0),  endMin: _toMin(17,0)  }, { type: 'post', startMin: _toMin(17,0),  endMin: _toMin(17,30) }],
  'Europe/London':     [{ type: 'pre', startMin: _toMin(7,0),   endMin: _toMin(8,0)   }, { type: 'regular', startMin: _toMin(8,0),   endMin: _toMin(16,30) }],
  'Europe/Berlin':     [{ type: 'pre', startMin: _toMin(8,0),   endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,30) }],
  'Europe/Paris':      [{ type: 'pre', startMin: _toMin(7,15),  endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,30) }],
  'Europe/Amsterdam':  [{ type: 'pre', startMin: _toMin(7,15),  endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,30) }],
  'Europe/Lisbon':     [{ type: 'pre', startMin: _toMin(7,15),  endMin: _toMin(8,0)   }, { type: 'regular', startMin: _toMin(8,0),   endMin: _toMin(16,30) }],
  'Europe/Madrid':     [{ type: 'pre', startMin: _toMin(8,30),  endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,35) }],
  'Europe/Rome':       [{ type: 'pre', startMin: _toMin(8,0),   endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,30) }],
  'Europe/Stockholm':  [{ type: 'pre', startMin: _toMin(8,0),   endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,30) }],
  'Europe/Helsinki':   [{ type: 'pre', startMin: _toMin(9,0),   endMin: _toMin(10,0)  }, { type: 'regular', startMin: _toMin(10,0),  endMin: _toMin(18,30) }],
  'Europe/Oslo':       [{ type: 'pre', startMin: _toMin(8,15),  endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(16,30) }],
  'Europe/Copenhagen': [{ type: 'pre', startMin: _toMin(8,0),   endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,0)  }],
  'Europe/Zurich':     [{ type: 'pre', startMin: _toMin(8,30),  endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,30) }],
  'Asia/Tokyo':        [{ type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(11,30) }, { type: 'regular', startMin: _toMin(12,30), endMin: _toMin(15,30) }],
  'Asia/Hong_Kong':    [{ type: 'pre', startMin: _toMin(9,0),   endMin: _toMin(9,30)  }, { type: 'regular', startMin: _toMin(9,30),  endMin: _toMin(12,0)  }, { type: 'regular', startMin: _toMin(13,0),  endMin: _toMin(16,0)  }],
  'Asia/Shanghai':     [{ type: 'regular', startMin: _toMin(9,30),  endMin: _toMin(11,30) }, { type: 'regular', startMin: _toMin(13,0),  endMin: _toMin(15,0)  }],
  'Asia/Seoul':        [{ type: 'pre', startMin: _toMin(8,0),   endMin: _toMin(9,0)   }, { type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(15,30) }],
  'Asia/Singapore':    [{ type: 'regular', startMin: _toMin(9,0),   endMin: _toMin(17,0)  }],
  'Asia/Kolkata':      [{ type: 'pre', startMin: _toMin(9,0),   endMin: _toMin(9,15)  }, { type: 'regular', startMin: _toMin(9,15),  endMin: _toMin(15,30) }],
  'Australia/Sydney':  [{ type: 'pre', startMin: _toMin(7,0),   endMin: _toMin(10,0)  }, { type: 'regular', startMin: _toMin(10,0),  endMin: _toMin(16,0)  }],
};

const TIMEZONE_EXCHANGE_LABEL: Record<string, string> = {
  'America/New_York':  'NYSE · NASDAQ',  'America/Chicago':   'CME Group',
  'America/Toronto':   'Toronto Stock Exchange',  'America/Sao_Paulo': 'B3 · São Paulo',
  'Europe/London':     'London Stock Exchange',   'Europe/Berlin':     'XETRA · Frankfurt',
  'Europe/Paris':      'Euronext Paris',          'Europe/Amsterdam':  'Euronext Amsterdam',
  'Europe/Lisbon':     'Euronext Lisboa',         'Europe/Madrid':     'Bolsa de Madrid',
  'Europe/Rome':       'Borsa Italiana',          'Europe/Stockholm':  'Nasdaq OMX Stockholm',
  'Europe/Helsinki':   'Nasdaq OMX Helsinki',     'Europe/Oslo':       'Oslo Børs',
  'Europe/Copenhagen': 'Nasdaq OMX Copenhagen',   'Europe/Zurich':     'SIX Swiss Exchange',
  'Asia/Tokyo':        'Tokyo Stock Exchange',    'Asia/Hong_Kong':    'HKEX',
  'Asia/Shanghai':     'Shanghai Stock Exchange', 'Asia/Seoul':        'Korea Exchange',
  'Asia/Singapore':    'Singapore Exchange',      'Asia/Kolkata':      'BSE · NSE India',
  'Australia/Sydney':  'ASX · Australia',
};

const SYMBOL_SUFFIX_TZ: Record<string, string> = {
  'L': 'Europe/London', 'IL': 'Europe/London',
  'DE': 'Europe/Berlin', 'F': 'Europe/Berlin', 'HM': 'Europe/Berlin', 'MU': 'Europe/Berlin',
  'BE': 'Europe/Berlin', 'DU': 'Europe/Berlin', 'HA': 'Europe/Berlin', 'SG': 'Europe/Berlin',
  'PA': 'Europe/Paris', 'NX': 'Europe/Paris',
  'AS': 'Europe/Amsterdam', 'LS': 'Europe/Lisbon',
  'MC': 'Europe/Madrid', 'MI': 'Europe/Rome',
  'ST': 'Europe/Stockholm', 'HE': 'Europe/Helsinki', 'OL': 'Europe/Oslo', 'CO': 'Europe/Copenhagen',
  'SW': 'Europe/Zurich', 'VX': 'Europe/Zurich',
  'TO': 'America/Toronto', 'SA': 'America/Sao_Paulo',
  'T': 'Asia/Tokyo', 'HK': 'Asia/Hong_Kong',
  'SS': 'Asia/Shanghai', 'SZ': 'Asia/Shanghai',
  'KS': 'Asia/Seoul', 'SI': 'Asia/Singapore',
  'NS': 'Asia/Kolkata', 'BO': 'Asia/Kolkata',
  'AX': 'Australia/Sydney',
};

function getExchangeTz(sym: string, quoteTz?: string): string {
  if (quoteTz) return quoteTz;
  const parts = sym.split('.');
  if (parts.length > 1) return SYMBOL_SUFFIX_TZ[parts[parts.length - 1].toUpperCase()] ?? 'America/New_York';
  return 'America/New_York';
}

const MKT_SESSION_CFG: Record<string, { label: string; color: string; bgColor: string; timelineColor: string }> = {
  pre:     { label: 'Pre-market',   color: '#fb923c', bgColor: '#431407', timelineColor: '#f97316' },
  regular: { label: 'Open',         color: '#86efac', bgColor: '#14532d', timelineColor: '#22c55e' },
  post:    { label: 'After-Hours',  color: '#93c5fd', bgColor: '#1e3a5f', timelineColor: '#6366f1' },
  closed:  { label: 'Closed',       color: '#94a3b8', bgColor: '#1e293b', timelineColor: '#334155' },
};
import { Svg, Circle as SvgCircle, Line as SvgLine, Path as SvgPath, Text as SvgText, Polyline as SvgPolyline, G as SvgG, Rect as SvgRect } from 'react-native-svg';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { RectButton } from 'react-native-gesture-handler';
import {
  getHistoricalData, getCandleData, getStockQuote, getDividends, getFundamentals, getNews, getFinnhubNews, getEarnings, getAnalystData, getInsiderTransactions, getFinancials, getEtfInfo, getPeerComparison, analyzeWithAI, analyzeNewsWithAI, analyzeFinancialsWithAI, generateScenarios, effectivePrice, fetchAVTechnicals, getRevenueEstimates, getDCF, generateWhatChanged,
  HistoricalData, CandleData, StockQuote, Fundamentals, NewsItem, Dividend, EarningsEvent, FinancialPeriod,
  AnalystConsensus, AnalystHistorical, PriceTargetConsensus, InsiderTransaction, EtfInfo, PeerComparison, AVTechnicals, RevenueEstimateYear, DCFResult, ScenarioResult, WhatChangedResult,
} from '../services/api';
import { calcFifo } from '../utils/format';
import { BlurValue } from '../utils/blurValue';
import InteractiveChart from '../components/InteractiveChart';
import CandlestickChart from '../components/CandlestickChart';
import ChartTypeToggleButton from '../components/ChartTypeToggleButton';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsContext';
import { usePortfolio } from '../context/PortfolioContext';
import AddTransactionModal from '../components/AddTransactionModal';
import PriceAlertModal from '../components/PriceAlertModal';

// Renders **bold** markdown inline, splitting on ** pairs
function MarkdownText({ text, style }: { text: string; style?: object }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <Text key={i} style={{ fontWeight: '700', color: '#f1f5f9' }}>{part}</Text>
          : part
      )}
    </Text>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PERIODS = ['1D', '1W', '1M', 'YTD', '1Y', '5Y', 'Max'] as const;
type Period = typeof PERIODS[number];
type Tab = 'overview' | 'portfolio' | 'dividends' | 'news' | 'analysts' | 'financials';

const WIDE_PARAMS: Record<Period, { range: string; interval: string }> = {
  '1D':  { range: '5d',  interval: '5m'  },
  '1W':  { range: '1mo', interval: '1h'  },
  '1M':  { range: '6mo', interval: '1d'  },
  'YTD': { range: '2y',  interval: '1wk' },
  '1Y':  { range: '5y',  interval: '1wk' },
  '5Y':  { range: 'max', interval: '1mo' },
  'Max': { range: 'max', interval: '1mo' },
};

// Candle chart uses finer intervals per period
const CANDLE_PARAMS: Record<Period, { range: string; interval: string }> = {
  '1D':  { range: '5d',  interval: '1m'  },  // 1m candles (Yahoo limit: 7d)
  '1W':  { range: '1mo', interval: '5m'  },  // 5m candles
  '1M':  { range: '1mo', interval: '30m' },  // 30m candles (Yahoo limit: ~60d)
  'YTD': { range: '2y',  interval: '1d'  },  // daily candles
  '1Y':  { range: '2y',  interval: '1d'  },  // daily candles
  '5Y':  { range: '5y',  interval: '1wk' },  // weekly candles
  'Max': { range: 'max', interval: '1wk' },  // weekly candles
};

function pointsForPeriod(timestamps: number[], period: Period): number {
  if (period === 'Max' || timestamps.length === 0) return timestamps.length;
  const now = Date.now() / 1000;
  // For 1D: start at today's pre-market open (4:00 AM ET = 08:00 UTC).
  // Use local midnight as a safe fallback for non-US stocks.
  const todayPreMarketStart = (() => {
    const d = new Date();
    // 4:00 AM ET in UTC = 08:00 UTC (EST) or 07:00 UTC (EDT)
    // Use local calendar date at 04:00 UTC as a universal approximation
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4, 0, 0) / 1000;
  })();
  const cutoffs: Record<Period, number> = {
    '1D':  todayPreMarketStart,
    '1W':  now - 7 * 86400,
    '1M':  now - 30 * 86400,
    'YTD': new Date(new Date().getFullYear(), 0, 1).getTime() / 1000,
    '1Y':  now - 365 * 86400,
    '5Y':  now - 5 * 365 * 86400,
    'Max': 0,
  };
  const idx = timestamps.findIndex((t) => t >= cutoffs[period]);
  const count = idx === -1 ? timestamps.length : timestamps.length - idx;
  return Math.max(5, count);
}

function fmtBig(val: number | null): string {
  if (val == null) return '—';
  const abs = Math.abs(val);
  if (abs >= 1e12) return `${(val / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${(val / 1e6).toFixed(2)}M`;
  return val.toLocaleString('en-US');
}
function fmtPct(val: number | null): string {
  if (val == null) return '—';
  return `${(val * 100).toFixed(2)}%`;
}
function fmtNum(val: number | null, decimals = 2): string {
  if (val == null) return '—';
  const [int, dec] = Math.abs(val).toFixed(decimals).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = val < 0 ? '-' : '';
  return decimals > 0 ? `${sign}${intFmt}.${dec}` : `${sign}${intFmt}`;
}

type Props = NativeStackScreenProps<RootStackParamList, 'StockDetail'>;

export default function StockDetailScreen({ route, navigation }: Props) {
  const { symbol, name } = route.params;
  const { currency, getRateFor, hideValues, groqKey, applyDividendTax } = useSettings();
  const { transactions, holdings, deleteTransaction, updateTransaction, watchlist, addToWatchlist, removeFromWatchlist, activePortfolioId } = usePortfolio();
  const isCombinedPortfolio = activePortfolioId === '__combined__';
  const isInWatchlist = watchlist.some((item) => item.symbol === symbol);

  // Lê shares e avgPrice do contexto em tempo real (atualiza quando há nova transação)
  const holding = holdings.find((h) => h.symbol === symbol);

  // Derive shares directly from transactions to avoid holding.shares desync
  const symbolTxs = transactions.filter(t => t.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date));
  const sharesFromTxs = symbolTxs.reduce((total, t) =>
    t.type === 'buy' ? total + t.shares : Math.max(0, total - t.shares), 0);
  const shares = symbolTxs.length > 0 ? sharesFromTxs : (holding?.shares ?? route.params.shares);

  // FIFO cost basis — Portuguese tax standard
  const fifo = calcFifo(symbolTxs);
  const avgPrice = symbolTxs.some(t => t.type === 'buy')
    ? fifo.avgPriceRemaining
    : (holding?.avgPrice ?? route.params.avgPrice);

  // Map txId → FIFO lot info for transaction history labels
  const fifoLotMap = new Map(fifo.lots.map(l => [l.txId, l]));

  const [txModalVisible, setTxModalVisible] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title: string; desc: string } | null>(null);
  const dividendNetMultiplier = applyDividendTax(1);
  const [descExpanded, setDescExpanded] = useState(false);
  const [showAllDivs, setShowAllDivs] = useState(false);
  const [marketHoursVisible, setMarketHoursVisible] = useState(false);
  const currencySymbol = currency === 'EUR' ? '€' : '$';

  // Edit / delete transaction overlay state
  const [editTx, setEditTx] = useState<{ id: string; type: 'buy' | 'sell' } | null>(null);
  const [deleteTxId, setDeleteTxId] = useState<string | null>(null);
  const [txKebabPos, setTxKebabPos] = useState<{ top: number; right: number } | null>(null);
  const [txKebabId, setTxKebabId] = useState<string | null>(null);
  const closeTxKebab = () => { setTxKebabPos(null); setTxKebabId(null); };
  const [editShares, setEditShares] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editFee, setEditFee] = useState('');
  const [editDateStr, setEditDateStr] = useState('');

  const formatDateInput = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const openEditTx = (tx: { id: string; type: 'buy' | 'sell'; shares: number; price: number; fee?: number; date: string }) => {
    const d = new Date(tx.date);
    setEditDateStr(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    setEditShares(tx.shares % 1 === 0 ? tx.shares.toFixed(0) : tx.shares.toString());
    setEditPrice(tx.price.toString());
    setEditFee(tx.fee != null && tx.fee > 0 ? tx.fee.toString() : '');
    setEditTx({ id: tx.id, type: tx.type });
  };

  const confirmEditTx = () => {
    if (isCombinedPortfolio) {
      Alert.alert('Read-only', 'Select a specific portfolio before editing transactions.');
      return;
    }
    if (!editTx) return;
    const numShares = parseFloat(editShares.replace(',', '.'));
    const numPrice = parseFloat(editPrice.replace(',', '.'));
    const numFee = parseFloat(editFee.replace(',', '.')) || 0;
    const dateParts = editDateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!numShares || !numPrice || numShares <= 0 || numPrice <= 0 || numFee < 0 || !dateParts) {
      Alert.alert('Error', 'Invalid values. Date must use the DD/MM/YYYY format.');
      return;
    }
    updateTransaction(editTx.id, {
      shares: numShares,
      price: numPrice,
      fee: numFee,
      date: `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`,
    });
    setEditTx(null);
  };

  const confirmDeleteTx = (id: string) => {
    if (isCombinedPortfolio) {
      Alert.alert('Read-only', 'Select a specific portfolio before deleting transactions.');
      return;
    }
    setDeleteTxId(id);
  };

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = windowWidth >= 768;
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [fullData, setFullData] = useState<HistoricalData>({ prices: [], timestamps: [] });
  const [chartLoading, setChartLoading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('1M');
  const [customFrom, setCustomFrom] = useState('');    // 'YYYY-MM-DD'
  const [customTo, setCustomTo]     = useState('');
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [chartType, setChartType] = useState<'line' | 'candle'>('line');
  const [candleData, setCandleData] = useState<CandleData>({ open: [], high: [], low: [], close: [], timestamps: [] });
  const [candleLoading, setCandleLoading] = useState(false);
  const [candleCrosshair, setCandleCrosshair] = useState<{ visible: boolean; price: number; ts: number }>({ visible: false, price: 0, ts: 0 });
  const [candleVisibleClose, setCandleVisibleClose] = useState<number[]>([]);
  const [candleVisibleTimestamps, setCandleVisibleTimestamps] = useState<number[]>([]);

  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [etfInfo, setEtfInfo] = useState<EtfInfo | null>(null);
  const [etfLoading, setEtfLoading] = useState(false);
  const [peerComparison, setPeerComparison] = useState<PeerComparison | null>(null);
  const [peerLoading, setPeerLoading] = useState(false);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [divLoading, setDivLoading] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsPage, setNewsPage] = useState(1);
  const [newsLoadingMore, setNewsLoadingMore] = useState(false);
  const [newsHasMore, setNewsHasMore] = useState(true);
  const [finnhubNews, setFinnhubNews] = useState<NewsItem[]>([]);
  const [finnhubNewsLoading, setFinnhubNewsLoading] = useState(false);
  const [finnhubNewsPage, setFinnhubNewsPage] = useState(1);
  const [finnhubNewsLoadingMore, setFinnhubNewsLoadingMore] = useState(false);
  const [finnhubNewsHasMore, setFinnhubNewsHasMore] = useState(true);
  const [newsSource, setNewsSource] = useState<'yahoo' | 'finnhub'>('yahoo');
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsPeriod, setEarningsPeriod] = useState<'quarter' | 'annual'>('quarter');
  const [earningsCard, setEarningsCard] = useState<{ event: EarningsEvent; idx: number } | null>(null);
  const [analystConsensus, setAnalystConsensus] = useState<AnalystConsensus | null>(null);
  const [analystHistorical, setAnalystHistorical] = useState<AnalystHistorical[]>([]);
  const [priceTargetConsensus, setPriceTargetConsensus] = useState<PriceTargetConsensus | null>(null);
  const [analystLoading, setAnalystLoading] = useState(false);
  const [revenueEstimates, setRevenueEstimates] = useState<RevenueEstimateYear[]>([]);
  const [revenueEstimatesLoading, setRevenueEstimatesLoading] = useState(false);
  const [activeForecastSeries, setActiveForecastSeries] = useState<string[]>(['rev', 'ni', 'eb']);
  const [insiderTx, setInsiderTx] = useState<InsiderTransaction[]>([]);
  const [insiderLoading, setInsiderLoading] = useState(false);
  const [alertModalVisible, setAlertModalVisible] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconActionButton
            icon={isInWatchlist ? 'star' : 'star-outline'}
            size={22}
            color={isInWatchlist ? '#f8fafc' : '#94a3b8'}
            onPress={() => {
              if (isInWatchlist) removeFromWatchlist(symbol);
              else addToWatchlist({ symbol, name });
            }}
            style={{ marginRight: 8 }}
            hitSlop={12}
          />
          <IconActionButton
            icon="notifications-outline"
            size={22}
            color="#94a3b8"
            onPress={() => setAlertModalVisible(true)}
            style={{ marginRight: 2 }}
            hitSlop={12}
          />
        </View>
      ),
    });
  }, [navigation, isInWatchlist, symbol, name, addToWatchlist, removeFromWatchlist]);

  const [financialsData, setFinancialsData] = useState<FinancialPeriod[]>([]);
  const [financialsLoading, setFinancialsLoading] = useState(false);
  const [financialsFreq, setFinancialsFreq] = useState<'quarterly' | 'annual'>('quarterly');
  const [financialsStmt, setFinancialsStmt] = useState<'income' | 'balance' | 'cashflow'>('income');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [avTechnicals, setAvTechnicals] = useState<AVTechnicals | null>(null);
  const [dcfResult, setDcfResult] = useState<DCFResult | null>(null);
  const [dcfLoading, setDcfLoading] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionMathExpanded, setDecisionMathExpanded] = useState(false);
  const [simBullScore, setSimBullScore] = useState('');
  const [simBaseScore, setSimBaseScore] = useState('');
  const [simBearScore, setSimBearScore] = useState('');

  // DCF Calculator (EPS-based, interactive)
  const [dcfCalcEps, setDcfCalcEps] = useState<string>('');
  const [dcfTooltipIdx, setDcfTooltipIdx] = useState<number | null>(null);
  const [dcfCalcGrowth, setDcfCalcGrowth] = useState<string>('15');
  const [dcfCalcMultiple, setDcfCalcMultiple] = useState<string>('');
  const [dcfCalcDesiredReturn, setDcfCalcDesiredReturn] = useState<string>('15');

  const [newsAiAnalysis, setNewsAiAnalysis] = useState<string | null>(null);
  const [newsAiLoading, setNewsAiLoading] = useState(false);
  const [newsAiError, setNewsAiError] = useState<string | null>(null);

  const [finAiAnalysis, setFinAiAnalysis] = useState<string | null>(null);
  const [finAiLoading, setFinAiLoading] = useState(false);
  const [finAiError, setFinAiError] = useState<string | null>(null);
  const [finAiFreq, setFinAiFreq] = useState<'quarterly' | 'annual' | null>(null);

  const [scenariosData, setScenariosData] = useState<ScenarioResult | null>(null);
  const [expandedScenarioCases, setExpandedScenarioCases] = useState<Record<'bull' | 'base' | 'bear', boolean>>({
    bull: false,
    base: true,
    bear: false,
  });

  // What Changed in 90 days
  const [whatChanged, setWhatChanged] = useState<WhatChangedResult | null>(null);
  const [whatChangedLoading, setWhatChangedLoading] = useState(false);
  const [whatChangedTab, setWhatChangedTab] = useState<'summary' | 'positives' | 'negatives' | 'changes'>('summary');
  const [whatChangedExpanded, setWhatChangedExpanded] = useState(false);

  // visible window from InteractiveChart (for periodGainPct, buy dots)
  const [visibleData, setVisibleData] = useState<{ prices: number[]; timestamps: number[] }>({ prices: [], timestamps: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    setRefreshing(false);
  }, []);

  useEffect(() => { getStockQuote(symbol).then(setQuote).catch(() => {}); }, [symbol, refreshTick]);

  useEffect(() => {
    setChartLoading(true);
    const { range, interval } = showCustomRange ? { range: 'max', interval: '1d' } : CANDLE_PARAMS[selectedPeriod];
    getHistoricalData(symbol, range, interval)
      .then((data) => { setFullData(data); })
      .catch(() => {})
      .finally(() => setChartLoading(false));
  }, [symbol, selectedPeriod, showCustomRange, refreshTick]);

  useEffect(() => {
    if (chartType !== 'candle') return;
    setCandleData({ open: [], high: [], low: [], close: [], timestamps: [] });
    setCandleVisibleClose([]);
    setCandleVisibleTimestamps([]);
    setCandleCrosshair({ visible: false, price: 0, ts: 0 });
    setCandleLoading(true);
    const { range, interval } = showCustomRange ? { range: 'max', interval: '1d' } : CANDLE_PARAMS[selectedPeriod];
    getCandleData(symbol, range, interval)
      .then(setCandleData)
      .catch(() => {})
      .finally(() => setCandleLoading(false));
  }, [symbol, selectedPeriod, showCustomRange, chartType, refreshTick]);

  // Lazy-load tab data on first visit
  useEffect(() => {
    if (activeTab === 'overview' && isEtf && !etfInfo && !etfLoading) {
      setEtfLoading(true);
      getEtfInfo(symbol).then(setEtfInfo).catch(() => {}).finally(() => setEtfLoading(false));
    }
    if (activeTab === 'overview' && !isEtf && !peerComparison && !peerLoading) {
      setPeerLoading(true);
      getPeerComparison(symbol).then(setPeerComparison).catch(() => {}).finally(() => setPeerLoading(false));
    }
    if ((isDesktop || activeTab === 'dividends' || activeTab === 'portfolio') && dividends.length === 0 && !divLoading) {
      setDivLoading(true);
      getDividends(symbol).then(setDividends).catch(() => {}).finally(() => setDivLoading(false));
    }
    if (activeTab === 'news' && news.length === 0 && !newsLoading) {
      setNewsLoading(true);
      getNews(symbol, 1).then((items) => {
        setNews(items);
        setNewsHasMore(items.length >= 10);
      }).catch(() => {}).finally(() => setNewsLoading(false));
    }
    if (activeTab === 'news' && finnhubNews.length === 0 && !finnhubNewsLoading) {
      setFinnhubNewsLoading(true);
      getFinnhubNews(symbol, 1).then((items) => {
        setFinnhubNews(items);
        setFinnhubNewsHasMore(items.length >= 5);
      }).catch(() => {}).finally(() => setFinnhubNewsLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, symbol]);

  // Carrega fundamentos logo na abertura
  useEffect(() => {
    setFundLoading(true);
    getFundamentals(symbol).then(setFundamentals).catch(() => {}).finally(() => setFundLoading(false));
  }, [symbol]);

  // Fetch ETF info once the quote loads and confirms it's an ETF
  useEffect(() => {
    if (quote?.quoteType === 'ETF' && !etfInfo && !etfLoading) {
      setEtfLoading(true);
      getEtfInfo(symbol).then(setEtfInfo).catch(() => {}).finally(() => setEtfLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.quoteType, symbol]);

  // Re-fetch earnings when symbol or period changes
  useEffect(() => {
    setEarningsLoading(true);
    getEarnings(symbol, earningsPeriod).then(setEarnings).catch(() => {}).finally(() => setEarningsLoading(false));
  }, [symbol, earningsPeriod]);

  useEffect(() => {
    if (activeTab === 'analysts' && !analystConsensus && !analystLoading) {
      setAnalystLoading(true);
      getAnalystData(symbol)
        .then(({ consensus, historical, priceTargetConsensus: ptc }) => {
          setAnalystConsensus(consensus);
          setAnalystHistorical(historical);
          setPriceTargetConsensus(ptc);
        })
        .catch(() => {})
        .finally(() => setAnalystLoading(false));
    }
    if (activeTab === 'analysts' && insiderTx.length === 0 && !insiderLoading) {
      setInsiderLoading(true);
      getInsiderTransactions(symbol).then(setInsiderTx).catch(() => {}).finally(() => setInsiderLoading(false));
    }
    if (activeTab === 'analysts' && revenueEstimates.length === 0 && !revenueEstimatesLoading) {
      setRevenueEstimatesLoading(true);
      getRevenueEstimates(symbol)
        .then(setRevenueEstimates)
        .catch((e) => { console.error('[RevEst]', e?.message ?? e); })
        .finally(() => setRevenueEstimatesLoading(false));
    }
    if (activeTab === 'analysts' && !dcfResult && !dcfLoading) {
      setDcfLoading(true);
      const price = quote ? effectivePrice(quote) : 0;
      getDCF(symbol, price)
        .then(setDcfResult)
        .catch(() => {})
        .finally(() => setDcfLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, symbol]);

  // Pre-fill DCF calculator when fundamentals arrive
  useEffect(() => {
    if (!fundamentals) return;
    const eps = fundamentals.trailingEps ?? fundamentals.forwardEps ?? null;
    const pe  = fundamentals.trailingPE  ?? fundamentals.forwardPE  ?? null;
    if (eps != null && eps > 0 && dcfCalcEps === '') setDcfCalcEps(eps.toFixed(2));
    if (pe  != null && pe  > 0 && dcfCalcMultiple === '') setDcfCalcMultiple(pe.toFixed(1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundamentals]);

  // Trigger What Changed once fundamentals are ready and tab is overview
  useEffect(() => {
    if (activeTab !== 'overview' || isEtf || whatChanged || whatChangedLoading || !fundamentals || !groqKey) return;
    setWhatChangedLoading(true);
    const price = quote ? effectivePrice(quote) : 0;
    Promise.all([
      getEarnings(symbol, 'quarter'),
      getInsiderTransactions(symbol),
      getNews(symbol, 1),
      getAnalystData(symbol),
    ]).then(([earn, ins, newsItems, analystData]) => {
      generateWhatChanged(
        groqKey, symbol, name ?? symbol, fundamentals,
        price, currency, earn, ins, newsItems,
        analystData.priceTargetConsensus,
      ).then(setWhatChanged).catch(() => {}).finally(() => setWhatChangedLoading(false));
    }).catch(() => setWhatChangedLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundamentals, activeTab]);

  // Re-fetch financials when tab is active or freq changes
  useEffect(() => {
    if (activeTab !== 'financials') return;
    setFinancialsLoading(true);
    getFinancials(symbol, financialsFreq)
      .then(setFinancialsData)
      .catch(() => {})
      .finally(() => setFinancialsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, symbol, financialsFreq]);

  // ---- visible window (tracked from InteractiveChart) ----
  const allPrices = fullData.prices;
  const allTimestamps = fullData.timestamps;
  const visiblePrices = visibleData.prices.length > 0 ? visibleData.prices : allPrices;
  const visibleTimestamps = visibleData.timestamps.length > 0 ? visibleData.timestamps : allTimestamps;

  // ---- custom date range slice ----
  const chartDisplayData = useMemo(() => {
    if (!showCustomRange || !customFrom || !customTo) return fullData;
    const fromTs = new Date(customFrom + 'T00:00:00').getTime() / 1000;
    const toTs   = new Date(customTo   + 'T23:59:59').getTime() / 1000;
    const startIdx = fullData.timestamps.findIndex(t => t >= fromTs);
    if (startIdx === -1) return { prices: [], timestamps: [] };
    let endIdx = startIdx;
    for (let i = fullData.timestamps.length - 1; i >= startIdx; i--) {
      if (fullData.timestamps[i] <= toTs) { endIdx = i; break; }
    }
    if (endIdx < startIdx) return { prices: [], timestamps: [] };
    return { prices: fullData.prices.slice(startIdx, endIdx + 1), timestamps: fullData.timestamps.slice(startIdx, endIdx + 1) };
  }, [fullData, showCustomRange, customFrom, customTo]);

  const candleDisplayData = useMemo(() => {
    if (!showCustomRange || !customFrom || !customTo) return candleData;
    const fromTs = new Date(customFrom + 'T00:00:00').getTime() / 1000;
    const toTs   = new Date(customTo   + 'T23:59:59').getTime() / 1000;
    const startIdx = candleData.timestamps.findIndex(t => t >= fromTs);
    if (startIdx === -1) return { open: [], high: [], low: [], close: [], timestamps: [] };
    let endIdx = startIdx;
    for (let i = candleData.timestamps.length - 1; i >= startIdx; i--) {
      if (candleData.timestamps[i] <= toTs) { endIdx = i; break; }
    }
    if (endIdx < startIdx) return { open: [], high: [], low: [], close: [], timestamps: [] };
    return {
      open:       candleData.open.slice(startIdx, endIdx + 1),
      high:       candleData.high.slice(startIdx, endIdx + 1),
      low:        candleData.low.slice(startIdx, endIdx + 1),
      close:      candleData.close.slice(startIdx, endIdx + 1),
      timestamps: candleData.timestamps.slice(startIdx, endIdx + 1),
    };
  }, [candleData, showCustomRange, customFrom, customTo]);

  // nativeCurrency comes from the live quote (most reliable), then holding fallback, then USD
  const nativeCurrency = quote?.currency ?? holding?.currency ?? 'USD';
  const nativeCurrencySymbol = nativeCurrency === 'EUR' ? '€'
    : nativeCurrency === 'USD' ? '$'
    : nativeCurrency === 'GBP' ? '£'
    : nativeCurrency;
  const sameAsCurrency = nativeCurrency === currency;
  const fxRate = getRateFor(nativeCurrency);
  const isEtf = quote?.quoteType === 'ETF';

  // nativePrice = raw quote in stock's own currency (e.g. DKK, EUR, GBP)
  // currentPrice = converted to display currency (€/$)
  const nativePrice = quote ? effectivePrice(quote) : avgPrice;
  const currentPrice = nativePrice * fxRate;
  const gainAbs = (currentPrice - avgPrice * fxRate) * shares;
  const gainPct = avgPrice > 0 ? ((nativePrice - avgPrice) / avgPrice) * 100 : 0;
  const isPositive = gainAbs >= 0;

  // Para o gráfico de velas: usar os closes visíveis em vez dos preços do linha
  const effectivePrices = chartType === 'candle' && candleVisibleClose.length > 0
    ? candleVisibleClose : visiblePrices;

  const firstVisible = effectivePrices[0] ?? 0;
  const livePrice = quote ? effectivePrice(quote) : (effectivePrices[effectivePrices.length - 1] ?? 0);
  const lastVisible = selectedPeriod === '1D' ? livePrice : (effectivePrices[effectivePrices.length - 1] ?? 0);
  const periodRef1D = quote?.pc ?? firstVisible;
  const periodGainPct = selectedPeriod === '1D'
    ? (periodRef1D > 0 ? ((livePrice - periodRef1D) / periodRef1D) * 100 : 0)
    : (firstVisible > 0 ? ((lastVisible - firstVisible) / firstVisible) * 100 : 0);
  const periodPos = periodGainPct >= 0;
  const chartColor = periodPos ? '#22c55e' : '#ef4444';

  useEffect(() => {
    const pm = scenariosData?.probabilityMath;
    if (!pm) return;
    setSimBullScore(String(pm.bullScore));
    setSimBaseScore(String(pm.baseScore));
    setSimBearScore(String(pm.bearScore));
  }, [scenariosData]);

  const simulatedProbabilityMath = useMemo(() => {
    const parse = (value: string, fallback: number) => {
      const n = Number(value.replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    const defaults = scenariosData?.probabilityMath;
    const bullScore = parse(simBullScore, defaults?.bullScore ?? 20);
    const baseScore = parse(simBaseScore, defaults?.baseScore ?? 30);
    const bearScore = parse(simBearScore, defaults?.bearScore ?? 20);
    const total = bullScore + baseScore + bearScore;
    if (total <= 0) return null;

    let bullProb = Math.round((bullScore / total) * 100);
    let bearProb = Math.round((bearScore / total) * 100);
    let baseProb = 100 - bullProb - bearProb;

    bullProb = Math.max(10, Math.min(65, bullProb));
    bearProb = Math.max(10, Math.min(65, bearProb));
    baseProb = 100 - bullProb - bearProb;
    if (baseProb < 10) {
      const excess = 10 - baseProb;
      baseProb = 10;
      if (bullProb > bearProb) bullProb -= excess; else bearProb -= excess;
    }

    const expectedValue = scenariosData?.bull.priceTarget != null && scenariosData?.base.priceTarget != null && scenariosData?.bear.priceTarget != null
      ? Math.round((
          (bullProb / 100) * scenariosData.bull.priceTarget +
          (baseProb / 100) * scenariosData.base.priceTarget +
          (bearProb / 100) * scenariosData.bear.priceTarget
        ) * 100) / 100
      : null;

    return {
      bullScore,
      baseScore,
      bearScore,
      bullProb,
      baseProb,
      bearProb,
      expectedValue,
    };
  }, [scenariosData, simBaseScore, simBearScore, simBullScore]);

  const displayScenarioSummary = useMemo(() => {
    if (!scenariosData) return null;
    return {
      bearProbability: simulatedProbabilityMath?.bearProb ?? scenariosData.bear.probability,
      baseProbability: simulatedProbabilityMath?.baseProb ?? scenariosData.base.probability,
      bullProbability: simulatedProbabilityMath?.bullProb ?? scenariosData.bull.probability,
      expectedValue: simulatedProbabilityMath?.expectedValue ?? scenariosData.expectedValue,
      bearPriceTarget: scenariosData.bear.priceTarget,
      basePriceTarget: scenariosData.base.priceTarget,
      bullPriceTarget: scenariosData.bull.priceTarget,
    };
  }, [scenariosData, simulatedProbabilityMath]);

  const investmentDecision = useMemo(() => {
    const dcfFairValue = dcfResult?.fairValue ?? null;
    const dcfGapPct = dcfFairValue != null && nativePrice > 0 ? ((dcfFairValue / nativePrice) - 1) * 100 : null;
    const scenarioExpectedValue = simulatedProbabilityMath?.expectedValue
      ?? displayScenarioSummary?.expectedValue
      ?? null;
    const decisionValue = scenarioExpectedValue
      ?? dcfFairValue
      ?? scenariosData?.base.priceTarget
      ?? null;
    const valuationGapPct = decisionValue != null && nativePrice > 0 ? ((decisionValue / nativePrice) - 1) * 100 : null;

    const rsi = avTechnicals?.rsi ?? null;
    const macdHist = avTechnicals?.macdHist ?? null;
    const sma50 = avTechnicals?.sma50 ?? null;
    const sma200 = avTechnicals?.sma200 ?? null;

    const aboveSma50 = sma50 != null ? nativePrice > sma50 : null;
    const aboveSma200 = sma200 != null ? nativePrice > sma200 : null;
    const nearSma50 = sma50 != null ? Math.abs(nativePrice - sma50) / nativePrice <= 0.035 : false;
    const nearSma200 = sma200 != null ? Math.abs(nativePrice - sma200) / nativePrice <= 0.05 : false;

    const supports = [sma50, sma200].filter((v): v is number => v != null).sort((a, b) => a - b);
    const supportLow = supports[0] ?? null;
    const supportHigh = supports[supports.length - 1] ?? null;

    const scenarioBase = displayScenarioSummary?.basePriceTarget ?? scenariosData?.base.priceTarget ?? null;
    const zoneCandidates = [supportLow, supportHigh, scenarioBase, decisionValue].filter((v): v is number => v != null && v > 0);
    const zoneLow = zoneCandidates.length > 0 ? Math.min(...zoneCandidates) : null;
    const zoneHigh = zoneCandidates.length > 0 ? Math.max(...zoneCandidates.filter(v => zoneLow == null || v >= zoneLow)) : null;

    let action = 'Need more data';
    let actionColor = '#94a3b8';
    let actionBg = '#1e293b';

    if (valuationGapPct != null && valuationGapPct >= 15 && ((rsi != null && rsi <= 45) || nearSma50 || nearSma200) && (macdHist == null || macdHist >= 0)) {
      action = 'Attractive entry window';
      actionColor = '#86efac';
      actionBg = '#14532d';
    } else if (valuationGapPct != null && valuationGapPct >= 8) {
      action = 'Good business, wait for pullback';
      actionColor = '#fde68a';
      actionBg = '#713f12';
    } else if (valuationGapPct != null && valuationGapPct <= -10) {
      action = 'Expensive vs fair value';
      actionColor = '#fca5a5';
      actionBg = '#7f1d1d';
    } else if (rsi != null && rsi >= 70) {
      action = 'Momentum is stretched';
      actionColor = '#fca5a5';
      actionBg = '#7f1d1d';
    } else if ((aboveSma50 === false && aboveSma200 === false) && macdHist != null && macdHist < 0) {
      action = 'Weak trend';
      actionColor = '#fca5a5';
      actionBg = '#7f1d1d';
    }

    const reasons: string[] = [];
    if (valuationGapPct != null) {
      reasons.push(valuationGapPct >= 0
        ? `The current price is ${valuationGapPct.toFixed(1)}% below the current decision value.`
        : `The current price is ${Math.abs(valuationGapPct).toFixed(1)}% above the current decision value.`);
    }
    if (dcfFairValue != null) {
      reasons.push(`DCF fair value is ${nativeCurrencySymbol}${dcfFairValue.toFixed(2)}.`);
    }
    if (scenarioExpectedValue != null) {
      reasons.push(`Scenario-weighted value is ${nativeCurrencySymbol}${scenarioExpectedValue.toFixed(2)}.`);
    }
    if (rsi != null) {
      reasons.push(
        rsi <= 35 ? `RSI at ${rsi.toFixed(1)} suggests an oversold or cooling zone.`
        : rsi >= 70 ? `RSI at ${rsi.toFixed(1)} suggests the stock is stretched in the short term.`
        : `RSI at ${rsi.toFixed(1)} is in a neutral zone.`
      );
    }
    if (supportLow != null || supportHigh != null) {
      const supportText = [supportLow, supportHigh]
        .filter((v): v is number => v != null)
        .map(v => `${nativeCurrencySymbol}${v.toFixed(2)}`)
        .join(' – ');
      reasons.push(`Approximate dynamic technical support from moving averages: ${supportText}.`);
    }
    if (displayScenarioSummary?.basePriceTarget != null) {
      reasons.push(`The base scenario points to ${nativeCurrencySymbol}${displayScenarioSummary.basePriceTarget.toFixed(2)}.`);
    }

    const technicalHeadline = rsi != null
      ? `RSI ${rsi.toFixed(1)}`
      : sma50 != null || sma200 != null
        ? 'Trend context'
        : 'Unavailable';

    const technicalDetail = macdHist != null
      ? `MACD ${macdHist >= 0 ? '▲' : '▼'} ${macdHist.toFixed(3)}`
      : sma50 != null && sma200 != null
        ? `SMA50 ${nativeCurrencySymbol}${sma50.toFixed(2)} | SMA200 ${nativeCurrencySymbol}${sma200.toFixed(2)}`
        : sma50 != null
          ? `SMA50 ${nativeCurrencySymbol}${sma50.toFixed(2)}`
          : sma200 != null
            ? `SMA200 ${nativeCurrencySymbol}${sma200.toFixed(2)}`
            : 'Technical data unavailable';

    return {
      ready: decisionValue != null || rsi != null || scenariosData != null,
      dcfFairValue,
      dcfGapPct,
      scenarioExpectedValue,
      decisionValue,
      valuationGapPct,
      rsi,
      macdHist,
      sma50,
      sma200,
      zoneLow,
      zoneHigh,
      technicalHeadline,
      technicalDetail,
      action,
      actionColor,
      actionBg,
      reasons,
    };
  }, [avTechnicals, dcfResult, displayScenarioSummary, nativeCurrencySymbol, nativePrice, scenariosData, simulatedProbabilityMath?.expectedValue]);

  const loadInvestmentDecision = useCallback(async () => {
    if (!fundamentals) return;
    setDecisionLoading(true);
    setDecisionError(null);
    const current = quote ? effectivePrice(quote) : nativePrice;

    const [techRes, dcfRes, scenariosRes] = await Promise.allSettled([
      avTechnicals ? Promise.resolve(avTechnicals) : fetchAVTechnicals(symbol),
      dcfResult ? Promise.resolve(dcfResult) : getDCF(symbol, current),
      groqKey ? generateScenarios(groqKey, symbol, name, fundamentals, current, nativeCurrencySymbol) : Promise.resolve(null),
    ]);

    let successCount = 0;
    if (techRes.status === 'fulfilled' && techRes.value) {
      setAvTechnicals(techRes.value);
      successCount += 1;
    }
    if (dcfRes.status === 'fulfilled' && dcfRes.value) {
      setDcfResult(dcfRes.value);
      successCount += 1;
    }
    if (scenariosRes.status === 'fulfilled' && scenariosRes.value) {
      setScenariosData(scenariosRes.value);
      successCount += 1;
    }

    if (successCount === 0) {
      setDecisionError('Could not load enough data for the investment decision.');
    }
    setDecisionLoading(false);
  }, [avTechnicals, dcfResult, fundamentals, groqKey, name, nativeCurrencySymbol, nativePrice, quote, symbol]);

  // ---- Chart constants (used in renderOverlay + InteractiveChart height prop) ----
  const CHART_H = isDesktop ? 480 : 300;
  const CH_PAD_TOP = 16;

  // ---- Sub-components ----
  const renderFundRow = (label: string, value: string, accent?: boolean) => {
    const glossary = FUND_GLOSSARY[label];
    return (
      <View style={styles.fundRow} key={label}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
          <Text style={styles.fundLabel}>{label}</Text>
          {glossary && (
            <Pressable
              onPress={() => setInfoModal(glossary)}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text style={{ color: '#9fb2d9', fontSize: 13, lineHeight: 18 }}>ⓘ</Text>
            </Pressable>
          )}
        </View>
        <Text style={[styles.fundValue, accent ? styles.fundValueAccent : null]}>{value}</Text>
      </View>
    );
  };

  const AnalistasTab = () => {
    if (analystLoading) return <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />;

    const total = analystConsensus
      ? analystConsensus.strongBuy + analystConsensus.buy + analystConsensus.hold + analystConsensus.sell + analystConsensus.strongSell
      : 0;

    const consensusColor = (c: string) => {
      const l = c.toLowerCase();
      if (l.includes('strong buy')) return '#16a34a';
      if (l.includes('buy')) return '#22c55e';
      if (l.includes('hold') || l.includes('neutral')) return '#f59e0b';
      if (l.includes('strong sell')) return '#b91c1c';
      if (l.includes('sell')) return '#ef4444';
      return '#6366f1';
    };

    // Barras horizontais para o histórico
    const histMax = analystHistorical.length > 0
      ? Math.max(...analystHistorical.map(h => h.strongBuy + h.buy + h.hold + h.sell + h.strongSell))
      : 1;

    return (
      <>
        {/* Current consensus */}
        {analystConsensus && total > 0 ? (
          <>
            <Text style={styles.fundSection}>Current Consensus</Text>
            <View style={[styles.fundCard, { padding: 16 }]}>
              {/* Badge consenso */}
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <View style={[styles.consensusBadge, { backgroundColor: consensusColor(analystConsensus.consensus) + '25', borderColor: consensusColor(analystConsensus.consensus) }]}>
                  <Text style={[styles.consensusBadgeTxt, { color: consensusColor(analystConsensus.consensus) }]}>
                    {analystConsensus.consensus}
                  </Text>
                </View>
                <Text style={styles.analystTotal}>{total} analysts</Text>
              </View>
              {/* Barra segmentada */}
              <View style={styles.segBar}>
                {analystConsensus.strongBuy > 0 && (
                  <View style={[styles.segBarSegment, { flex: analystConsensus.strongBuy, backgroundColor: '#16a34a' }]} />
                )}
                {analystConsensus.buy > 0 && (
                  <View style={[styles.segBarSegment, { flex: analystConsensus.buy, backgroundColor: '#22c55e' }]} />
                )}
                {analystConsensus.hold > 0 && (
                  <View style={[styles.segBarSegment, { flex: analystConsensus.hold, backgroundColor: '#f59e0b' }]} />
                )}
                {analystConsensus.sell > 0 && (
                  <View style={[styles.segBarSegment, { flex: analystConsensus.sell, backgroundColor: '#ef4444' }]} />
                )}
                {analystConsensus.strongSell > 0 && (
                  <View style={[styles.segBarSegment, { flex: analystConsensus.strongSell, backgroundColor: '#b91c1c' }]} />
                )}
              </View>
              {/* Legenda */}
              <View style={styles.segLegend}>
                {[
                  { label: 'Strong Buy', val: analystConsensus.strongBuy, color: '#16a34a' },
                  { label: 'Buy', val: analystConsensus.buy, color: '#22c55e' },
                  { label: 'Hold', val: analystConsensus.hold, color: '#f59e0b' },
                  { label: 'Sell', val: analystConsensus.sell, color: '#ef4444' },
                  { label: 'Strong Sell', val: analystConsensus.strongSell, color: '#b91c1c' },
                ].map(x => (
                  <View key={x.label} style={styles.segLegendItem}>
                    <View style={[styles.segLegendDot, { backgroundColor: x.color, opacity: x.val > 0 ? 1 : 0.3 }]} />
                    <Text style={[styles.segLegendTxt, { opacity: x.val > 0 ? 1 : 0.3 }]}>{x.label}: {x.val}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}

        {/* Historical trend */}
        {analystHistorical.length > 0 && (
          <>
            <Text style={styles.fundSection}>Trend (recent periods)</Text>
            <View style={[styles.fundCard, { padding: 16 }]}>
              {analystHistorical.map((h) => {
                const rowTotal = h.strongBuy + h.buy + h.hold + h.sell + h.strongSell || 1;
                return (
                  <View key={h.date} style={styles.histRow}>
                    <Text style={styles.histDateTxt}>
                      {new Date(h.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                    </Text>
                    <View style={styles.histBar}>
                      {h.strongBuy > 0 && <View style={{ flex: h.strongBuy / rowTotal, backgroundColor: '#16a34a', height: '100%' }} />}
                      {h.buy > 0 && <View style={{ flex: h.buy / rowTotal, backgroundColor: '#22c55e', height: '100%' }} />}
                      {h.hold > 0 && <View style={{ flex: h.hold / rowTotal, backgroundColor: '#f59e0b', height: '100%' }} />}
                      {h.sell > 0 && <View style={{ flex: h.sell / rowTotal, backgroundColor: '#ef4444', height: '100%' }} />}
                      {h.strongSell > 0 && <View style={{ flex: h.strongSell / rowTotal, backgroundColor: '#b91c1c', height: '100%' }} />}
                    </View>
                    <Text style={styles.histTotalTxt}>{rowTotal}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Price Target */}
        {priceTargetConsensus && priceTargetConsensus.targetHigh > 0 && (
          <>
            <Text style={styles.fundSection}>Price Target (Analysts)</Text>
            <View style={[styles.fundCard, { padding: 16 }]}>
              {/* Range bar: low → high with markers */}
              {(() => {
                const { targetLow, targetHigh, targetConsensus, targetMedian } = priceTargetConsensus;
                const currentPrice = quote?.c ?? 0;
                const range = targetHigh - targetLow || 1;
                const pct = (v: number) => Math.max(0, Math.min(1, (v - targetLow) / range));
                return (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={styles.ptRangeLabel}>${targetLow.toFixed(0)}</Text>
                      <Text style={[styles.ptRangeLabel, { color: '#6366f1', fontWeight: '700' }]}>
                        Consensus ${targetConsensus.toFixed(2)}
                      </Text>
                      <Text style={styles.ptRangeLabel}>${targetHigh.toFixed(0)}</Text>
                    </View>
                    <View style={styles.ptTrack}>
                      {/* Fill up to consensus */}
                      <View style={[styles.ptFill, { width: `${pct(targetConsensus) * 100}%` }]} />
                      {/* Median marker */}
                      <View style={[styles.ptMarker, { left: `${pct(targetMedian) * 100}%`, backgroundColor: '#f59e0b' }]} />
                      {/* Current price marker */}
                      {currentPrice > 0 && (
                        <View style={[styles.ptMarker, { left: `${pct(currentPrice) * 100}%`, backgroundColor: '#f1f5f9', zIndex: 3 }]} />
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                      <View style={styles.ptLegendItem}>
                        <View style={[styles.ptLegendDot, { backgroundColor: '#6366f1' }]} />
                        <Text style={styles.ptLegendTxt}>Consensus ${targetConsensus.toFixed(2)}</Text>
                      </View>
                      <View style={styles.ptLegendItem}>
                        <View style={[styles.ptLegendDot, { backgroundColor: '#f59e0b' }]} />
                        <Text style={styles.ptLegendTxt}>Mediana ${targetMedian.toFixed(2)}</Text>
                      </View>
                      {currentPrice > 0 && (
                        <View style={styles.ptLegendItem}>
                          <View style={[styles.ptLegendDot, { backgroundColor: '#f1f5f9' }]} />
                          <Text style={styles.ptLegendTxt}>Current ${currentPrice.toFixed(2)}</Text>
                        </View>
                      )}
                    </View>
                    {/* Upside/downside */}
                    {currentPrice > 0 && (
                      <View style={{ alignItems: 'center', marginTop: 10 }}>
                        {(() => {
                          const upside = ((targetConsensus - currentPrice) / currentPrice) * 100;
                          const isUp = upside >= 0;
                          return (
                            <Text style={{ color: isUp ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: '700' }}>
                              {isUp ? '▲' : '▼'} {Math.abs(upside).toFixed(1)}% potential {isUp ? 'upside' : 'downside'}
                            </Text>
                          );
                        })()}
                      </View>
                    )}
                  </>
                );
              })()}
            </View>
          </>
        )}

        {/* ── EPS-Based DCF Calculator ──────────────────────────────── */}
        <Text style={styles.fundSection}>DCF Calculator</Text>
        {(() => {
          const CHART_W = SCREEN_WIDTH - 32;
          const CHART_H = 180;
          const PAD_L = 46;
          const PAD_R = 12;
          const PAD_T = 12;
          const PAD_B = 28;

          const parse        = (s: string) => parseFloat(s.replace(',', '.'));
          const epsVal      = parse(dcfCalcEps)           || 0;
          const growthVal   = parse(dcfCalcGrowth)  / 100 || 0;
          const multipleVal = parse(dcfCalcMultiple)      || 20;
          const desiredVal  = parse(dcfCalcDesiredReturn) / 100 || 0.15;
          const currentPrice = nativePrice;

          // year 5 target = EPS-based fair value; path is geometric from currentPrice → futurePrice
          const futurePrice = epsVal > 0 && multipleVal > 0
            ? epsVal * Math.pow(1 + growthVal, 5) * multipleVal
            : 0;

          // 6 chart points: start at currentPrice, end at futurePrice, smooth geometric curve
          const projPrices: number[] = [];
          const base = currentPrice > 0 ? currentPrice : (epsVal * multipleVal || 0);
          for (let y = 0; y <= 5; y++) {
            if (base > 0 && futurePrice > 0) {
              projPrices.push(base * Math.pow(futurePrice / base, y / 5));
            } else {
              projPrices.push(0);
            }
          }

          const returnFromToday = currentPrice > 0 && futurePrice > 0
            ? (Math.pow(futurePrice / currentPrice, 1 / 5) - 1) * 100
            : null;
          const entryPrice = futurePrice > 0 && desiredVal >= 0
            ? futurePrice / Math.pow(1 + desiredVal, 5)
            : null;

          const currentYear = new Date().getFullYear();
          const labels = Array.from({ length: 6 }, (_, i) => `Q1 ${currentYear + i}`);

          // Read-only current earnings from fundamentals
          const f = fundamentals;
          const curEps   = f?.trailingEps  ?? null;
          const curPe    = f?.trailingPE   ?? null;
          const curGrowth = f?.earningsGrowth != null
            ? (f.earningsGrowth * 100).toFixed(1) + '%'
            : f?.revenueGrowth  != null
              ? (f.revenueGrowth  * 100).toFixed(1) + '%'
              : null;

          // Chart scaling
          const allPrices = [currentPrice, ...projPrices].filter(v => v > 0);
          const minY = allPrices.length > 0 ? Math.min(...allPrices) * 0.88 : 0;
          const maxY = allPrices.length > 0 ? Math.max(...allPrices) * 1.12 : 1;
          const range = maxY - minY || 1;
          const scaleX = (i: number) => PAD_L + (i / 5) * (CHART_W - PAD_L - PAD_R);
          const scaleY = (v: number) => PAD_T + (1 - (v - minY) / range) * (CHART_H - PAD_T - PAD_B);

          const linePoints = projPrices
            .map((v, i) => `${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`)
            .join(' ');

          const inputBase = {
            flex: 1,
            backgroundColor: '#0f172a',
            borderWidth: 1,
            borderColor: '#1e293b',
            borderRadius: 8,
            color: '#f1f5f9' as const,
            fontSize: 16,
            paddingHorizontal: 12,
            paddingVertical: 10,
          };

          return (
            <View style={[styles.fundCard, { padding: 0, overflow: 'hidden' }]}>

              {/* ── Current Earnings header ─── */}
              <View style={{ borderBottomWidth: 1, borderBottomColor: '#1e293b', paddingHorizontal: 14, paddingVertical: 10 }}>
                <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 8 }}>
                  Current Earnings
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ alignItems: 'flex-start' }}>
                    <Text style={{ color: '#64748b', fontSize: 10 }}>EPS (TTM)</Text>
                    <Text style={{ color: '#f1f5f9', fontSize: 14, fontWeight: '700' }}>
                      {curEps != null ? `${nativeCurrencySymbol}${curEps.toFixed(2)}` : '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: '#64748b', fontSize: 10 }}>PE (TTM)</Text>
                    <Text style={{ color: '#f1f5f9', fontSize: 14, fontWeight: '700' }}>
                      {curPe != null ? curPe.toFixed(1) : '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: '#64748b', fontSize: 10 }}>EPS Growth</Text>
                    <Text style={{ color: curGrowth?.startsWith('-') ? '#ef4444' : '#22c55e', fontSize: 14, fontWeight: '700' }}>
                      {curGrowth ?? '—'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* ── Inputs ─── */}
              <View style={{ padding: 14, gap: 16 }}>

                {/* EPS (TTM) */}
                <View>
                  <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginBottom: 6 }}>EPS (TTM)</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0 }}>
                    <View style={{
                      backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
                      borderTopLeftRadius: 8, borderBottomLeftRadius: 8,
                      paddingHorizontal: 12, paddingVertical: 10,
                    }}>
                      <Text style={{ color: '#94a3b8', fontSize: 16 }}>{nativeCurrencySymbol}</Text>
                    </View>
                    <TextInput
                      value={dcfCalcEps}
                      onChangeText={setDcfCalcEps}
                      placeholder="0.00"
                      placeholderTextColor="#334155"
                      keyboardType="decimal-pad"
                      style={[inputBase, { borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeftWidth: 0 }]}
                    />
                  </View>
                  <Text style={{ color: '#8f99aa', fontSize: 11, marginTop: 4 }}>
                    The Earnings Per Share over the last 12 months.
                  </Text>
                </View>

                {/* EPS Growth Rate */}
                <View>
                  <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginBottom: 6 }}>EPS Growth Rate</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TextInput
                      value={dcfCalcGrowth}
                      onChangeText={setDcfCalcGrowth}
                      placeholder="15"
                      placeholderTextColor="#334155"
                      keyboardType="decimal-pad"
                      style={[inputBase, { borderTopRightRadius: 0, borderBottomRightRadius: 0 }]}
                    />
                    <View style={{
                      backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
                      borderTopRightRadius: 8, borderBottomRightRadius: 8, borderLeftWidth: 0,
                      paddingHorizontal: 14, paddingVertical: 10,
                    }}>
                      <Text style={{ color: '#94a3b8', fontSize: 16 }}>%</Text>
                    </View>
                  </View>
                  <Text style={{ color: '#8f99aa', fontSize: 11, marginTop: 4 }}>
                    Your assumption of the company&apos;s expected yearly EPS growth rate as a percentage (e.g., 10 for 10% per year).
                  </Text>
                </View>

                {/* Appropriate EPS Multiple */}
                <View>
                  <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Appropriate EPS Multiple</Text>
                  <TextInput
                    value={dcfCalcMultiple}
                    onChangeText={setDcfCalcMultiple}
                    placeholder="20"
                    placeholderTextColor="#334155"
                    keyboardType="decimal-pad"
                    style={inputBase}
                  />
                  <Text style={{ color: '#8f99aa', fontSize: 11, marginTop: 4 }}>
                    The PE ratio you consider appropriate for the stock to trade at.
                  </Text>
                </View>

                {/* Desired Return */}
                <View>
                  <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Desired Return</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TextInput
                      value={dcfCalcDesiredReturn}
                      onChangeText={setDcfCalcDesiredReturn}
                      placeholder="15"
                      placeholderTextColor="#334155"
                      keyboardType="decimal-pad"
                      style={[inputBase, { borderTopRightRadius: 0, borderBottomRightRadius: 0 }]}
                    />
                    <View style={{
                      backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
                      borderTopRightRadius: 8, borderBottomRightRadius: 8, borderLeftWidth: 0,
                      paddingHorizontal: 14, paddingVertical: 10,
                    }}>
                      <Text style={{ color: '#94a3b8', fontSize: 16 }}>%</Text>
                    </View>
                  </View>
                  <Text style={{ color: '#8f99aa', fontSize: 11, marginTop: 4 }}>
                    This is the annualized return you aim to achieve from the stock. The calculator will determine the price you need to pay to attain this return based on your assumptions.
                  </Text>
                </View>
              </View>

              {/* ── Calculation Results ─── */}
              <View style={{ borderTopWidth: 1, borderTopColor: '#1e293b', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }}>
                <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 10 }}>
                  Calculation Results
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, backgroundColor: '#0f172a', borderRadius: 10, padding: 12 }}>
                    <Text style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Return from today&apos;s price</Text>
                    <Text style={{
                      fontSize: 22, fontWeight: '800',
                      color: returnFromToday == null ? '#475569' : returnFromToday >= 0 ? '#22c55e' : '#ef4444',
                    }}>
                      {returnFromToday == null ? '—' : `${returnFromToday.toFixed(2)}%`}
                    </Text>
                    <Text style={{ color: '#8f99aa', fontSize: 11, marginTop: 2 }}>annualized (5-yr CAGR)</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#0f172a', borderRadius: 10, padding: 12 }}>
                    <Text style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>
                      Entry Price for {dcfCalcDesiredReturn || '15'}% Return
                    </Text>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: '#f1f5f9' }}>
                      {entryPrice == null || entryPrice <= 0 ? '—'
                        : `${nativeCurrencySymbol}${entryPrice.toFixed(2)}`}
                    </Text>
                    <Text style={{ color: '#8f99aa', fontSize: 11, marginTop: 2 }}>
                      {entryPrice != null && currentPrice > 0
                        ? entryPrice >= currentPrice
                          ? `${((entryPrice / currentPrice - 1) * 100).toFixed(1)}% above current`
                          : `${((1 - entryPrice / currentPrice) * 100).toFixed(1)}% below current`
                        : 'based on 5-yr target'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* ── 5-Year projection chart ─── */}
              <View style={{ borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 10, paddingBottom: 8 }}>
                <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
                  5-Year Price Projection
                </Text>
                {/* Legend */}
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 16, height: 2, backgroundColor: '#4ade80' }} />
                    <Text style={{ color: '#94a3b8', fontSize: 10 }}>Projected Price</Text>
                  </View>
                  {entryPrice != null && entryPrice > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <View style={{ width: 16, height: 1, borderStyle: 'dashed', borderWidth: 1, borderColor: '#22c55e' }} />
                      <Text style={{ color: '#22c55e', fontSize: 10 }}>
                        Entry ({nativeCurrencySymbol}{entryPrice.toFixed(2)})
                      </Text>
                    </View>
                  )}
                </View>
                <Svg width={CHART_W} height={CHART_H} style={{ alignSelf: 'center' }}>
                  {/* Grid lines + Y labels */}
                  {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                    const val  = minY + frac * range;
                    const yPos = PAD_T + (1 - frac) * (CHART_H - PAD_T - PAD_B);
                    return (
                      <React.Fragment key={frac}>
                        <SvgLine x1={PAD_L} y1={yPos} x2={CHART_W - PAD_R} y2={yPos} stroke="#1e293b" strokeWidth={1} />
                        <SvgText x={PAD_L - 4} y={yPos + 4} fontSize={8} fill="#475569" textAnchor="end">
                          {val >= 1000 ? `${nativeCurrencySymbol}${(val / 1000).toFixed(1)}k` : `${nativeCurrencySymbol}${val.toFixed(0)}`}
                        </SvgText>
                      </React.Fragment>
                    );
                  })}

                  {/* Entry price dashed line */}
                  {entryPrice != null && entryPrice > 0 && (() => {
                    const epY = scaleY(entryPrice);
                    if (epY < PAD_T || epY > CHART_H - PAD_B) return null;
                    return (
                      <SvgLine x1={PAD_L} y1={epY} x2={CHART_W - PAD_R} y2={epY} stroke="#22c55e" strokeWidth={1} strokeDasharray="4,3" />
                    );
                  })()}

                  {/* Projection line */}
                  {epsVal > 0 && multipleVal > 0 && (
                    <SvgPolyline points={linePoints} fill="none" stroke="#4ade80" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                  )}

                  {/* Dots + X labels */}
                  {projPrices.map((v, i) => {
                    if (v <= 0) return null;
                    const cx = scaleX(i);
                    const cy = scaleY(v);
                    return (
                      <React.Fragment key={i}>
                        <SvgG onPress={() => setDcfTooltipIdx(dcfTooltipIdx === i ? null : i)}>
                          {/* Larger invisible hit area */}
                          <SvgCircle cx={cx} cy={cy} r={14} fill="transparent" />
                          <SvgCircle cx={cx} cy={cy} r={dcfTooltipIdx === i ? 6 : 4} fill="#4ade80" />
                        </SvgG>
                        <SvgText x={cx} y={CHART_H - PAD_B + 12} fontSize={7} fill="#64748b" textAnchor="middle">
                          {labels[i]}
                        </SvgText>
                      </React.Fragment>
                    );
                  })}

                  {/* Tooltip */}
                  {dcfTooltipIdx !== null && projPrices[dcfTooltipIdx] > 0 && (() => {
                    const ti = dcfTooltipIdx;
                    const tx = scaleX(ti);
                    const ty = scaleY(projPrices[ti]);
                    const TW = 130;
                    const TH = 44;
                    const TX = Math.min(Math.max(tx - TW / 2, PAD_L), CHART_W - PAD_R - TW);
                    const TY = ty - TH - 10 < PAD_T ? ty + 14 : ty - TH - 10;
                    return (
                      <SvgG>
                        <SvgRect x={TX} y={TY} width={TW} height={TH} rx={6} ry={6} fill="#1e293b" />
                        <SvgText x={TX + TW / 2} y={TY + 14} fontSize={10} fill="#94a3b8" textAnchor="middle" fontWeight="600">
                          {labels[ti]}
                        </SvgText>
                        <SvgRect x={TX + 10} y={TY + 22} width={8} height={8} rx={2} ry={2} fill="#4ade80" />
                        <SvgText x={TX + 22} y={TY + 30} fontSize={10} fill="#f1f5f9" textAnchor="start">
                          {`Projected Price: ${nativeCurrencySymbol}${projPrices[ti].toFixed(2)}`}
                        </SvgText>
                      </SvgG>
                    );
                  })()}
                </Svg>
              </View>

              {/* ── Footer ─── */}
              <View style={{ borderTopWidth: 1, borderTopColor: '#1e293b', padding: 8, gap: 3 }}>
                <Text style={{ color: '#334155', fontSize: 9 }}>
                  Future Price = EPS × (1+g)^5 × Multiple · Entry = Future Price ÷ (1+r)^5
                </Text>
                {entryPrice != null && entryPrice > 0 && (
                  <Text style={{ color: '#334155', fontSize: 9 }}>
                    Max entry for {dcfCalcDesiredReturn || '15'}% return: <Text style={{ color: currentPrice > entryPrice ? '#ef4444' : '#22c55e' }}>{nativeCurrencySymbol}{entryPrice.toFixed(2)}</Text> — current {nativeCurrencySymbol}{currentPrice.toFixed(2)} is {currentPrice > entryPrice ? 'above (overpriced for target)' : 'below (on track to exceed target)'}.
                  </Text>
                )}
              </View>
            </View>
          );
        })()}

        {/* ── Intrinsic Value (DCF) ─────────────────────────────────── */}
        <Text style={styles.fundSection}>Share Price vs Intrinsic Value (DCF)</Text>
        {dcfLoading ? (
          <ActivityIndicator color="#6366f1" style={{ marginVertical: 12 }} />
        ) : dcfResult ? (() => {
          const { fairValue, currentPrice: dcfPrice, discountPct, wacc, growthRate, source } = dcfResult;
          const cp = dcfPrice > 0 ? dcfPrice : (quote ? effectivePrice(quote) : 0);
          const fv = fairValue;
          const isUnder = discountPct >= 0;
          const absPct = Math.abs(discountPct);
          const badgeColor = absPct <= 10 ? '#f59e0b' : isUnder ? '#22c55e' : '#ef4444';
          const badgeLabel = absPct <= 10 ? 'About Right' : isUnder ? `${absPct.toFixed(1)}% Undervalued` : `${absPct.toFixed(1)}% Overvalued`;

          // Scale: fv * 1.5 so overvalued zone always visible
          const scale = fv * 1.5;
          const z1 = (fv * 0.80) / scale; // green → gold boundary
          const z2 = (fv * 1.20) / scale; // gold → red boundary
          const cpF = Math.min(Math.max(cp / scale, 0.05), 0.97);
          const fvF = Math.min(Math.max(fv / scale, 0.05), 0.97);

          // Layout constants
          const STRIP = 7;  // thin colored strip height (top, between, bottom)
          const BAR_H = 54; // each dark bar height
          const GAP   = 4;  // gap between bar1 and bar2

          return (
            <View style={[styles.fundCard, { overflow: 'hidden', padding: 0 }]}>

              {/* ── Badge + connector ────────────────────────────── */}
              <View style={{ paddingTop: 14, paddingBottom: 6, paddingHorizontal: 16 }}>
                {/* connector dot + line aligns to cpF position */}
                <View style={{ position: 'relative', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ color: badgeColor, fontSize: 26, fontWeight: '800' }}>
                    {isUnder ? '+' : ''}{discountPct.toFixed(1)}%
                  </Text>
                  <Text style={{ color: badgeColor, fontSize: 12, fontWeight: '600' }}>{badgeLabel}</Text>
                </View>
                {/* Connector line: positioned at cpF from left */}
                <View style={{ height: 12, position: 'relative' }}>
                  <View style={{
                    position: 'absolute',
                    left: `${cpF * 100}%` as unknown as number,
                    top: 0, width: 2, height: 12,
                    backgroundColor: badgeColor,
                    transform: [{ translateX: -1 }],
                  }} />
                </View>
              </View>

              {/* ── Chart area ───────────────────────────────────── */}
              <View style={{ position: 'relative', height: STRIP * 3 + BAR_H * 2 + GAP }}>

                {/* Colorful zone background — full width, full height */}
                <View style={{ position: 'absolute', inset: 0, flexDirection: 'row' }}>
                  <View style={{ flex: z1,       backgroundColor: '#16a34a' }} />
                  <View style={{ flex: z2 - z1,  backgroundColor: '#ca8a04' }} />
                  <View style={{ flex: 1 - z2,   backgroundColor: '#7f1d1d' }} />
                </View>

                {/* Bar 1: Current Price — solid dark, top strip visible above */}
                <View style={{
                  position: 'absolute',
                  top: STRIP,
                  left: 0,
                  width: `${cpF * 100}%` as unknown as number,
                  height: BAR_H,
                  backgroundColor: '#0c1220',
                  justifyContent: 'center',
                  paddingLeft: 14,
                }}>
                  <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '500' }}>Current Price</Text>
                  <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '800' }}>{cp.toFixed(2)}</Text>
                </View>

                {/* Bar 2: Cash Flow Value — semi-transparent dark, strip visible between */}
                <View style={{
                  position: 'absolute',
                  top: STRIP + BAR_H + GAP + STRIP,
                  left: 0,
                  width: `${fvF * 100}%` as unknown as number,
                  height: BAR_H,
                  backgroundColor: 'rgba(10,18,30,0.80)',
                  justifyContent: 'center',
                  paddingLeft: 14,
                }}>
                  <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '500' }}>Cash Flow Value</Text>
                  <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '800' }}>{fv.toFixed(2)}</Text>
                </View>
              </View>

              {/* Zone labels — proportional to zone widths */}
              <View style={{ flexDirection: 'row', paddingVertical: 7 }}>
                <View style={{ flex: z1, alignItems: 'flex-start', paddingLeft: 8 }}>
                  <Text style={{ color: '#22c55e', fontSize: 9, fontWeight: '700' }}>20% Undervalued</Text>
                </View>
                <View style={{ flex: z2 - z1, alignItems: 'center' }}>
                  <Text style={{ color: '#f59e0b', fontSize: 9, fontWeight: '700' }}>About Right</Text>
                </View>
                <View style={{ flex: 1 - z2, alignItems: 'flex-end', paddingRight: 8 }}>
                  <Text style={{ color: '#ef4444', fontSize: 9, fontWeight: '700' }}>20% Overvalued</Text>
                </View>
              </View>

              {/* Footer */}
              <View style={{ borderTopWidth: 1, borderTopColor: '#1e293b', paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <Text style={{ color: '#475569', fontSize: 9 }}>FCF/share: {dcfResult.fcfBase.toFixed(2)}</Text>
                <Text style={{ color: '#475569', fontSize: 9 }}>Growth (5Y): {growthRate.toFixed(1)}%</Text>
                <Text style={{ color: '#475569', fontSize: 9 }}>WACC: {wacc.toFixed(1)}%</Text>
                <Text style={{ color: '#475569', fontSize: 9 }}>Terminal: 2.5%</Text>
                <Text style={{ color: source === 'analyst' ? '#6366f1' : '#475569', fontSize: 9 }}>
                  {source === 'analyst' ? '● analyst consensus' : '● historical'}
                </Text>
              </View>
            </View>
          );
        })() : (
          <View style={[styles.fundCard, { padding: 16, alignItems: 'center' }]}>
            <Text style={{ color: '#64748b', fontSize: 13 }}>No DCF data available for this stock</Text>
          </View>
        )}

        {/* ── Earnings & Revenue Growth Forecasts ──────────────────── */}
        <Text style={styles.fundSection}>Earnings &amp; Revenue Growth Forecasts</Text>
        {revenueEstimatesLoading ? (
          <ActivityIndicator color="#6366f1" style={{ marginVertical: 12 }} />
        ) : revenueEstimates.length >= 2 ? (() => {
          const fmtShort = (v: number | null) => {
            if (v == null) return '—';
            const abs = Math.abs(v);
            if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
            if (abs >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
            if (abs >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`;
            return `$${v.toFixed(2)}`;
          };

          const rows = revenueEstimates;
          const n = rows.length;

          // Series definitions — value = actual if available, else estimate avg
          type Serie = {
            key: string;
            label: string;
            color: string;
            fill: string;
            getValue: (d: RevenueEstimateYear) => number | null;
            getAvg:   (d: RevenueEstimateYear) => number | null;
            numAnalysts: (d: RevenueEstimateYear) => number | null;
          };
          const ALL_SERIES: Serie[] = [
            { key: 'rev',  label: 'Revenue',    color: '#3b82f6', fill: 'rgba(59,130,246,0.12)',
              getValue: d => d.isActual && d.revenue   != null ? d.revenue   : d.estAvg,
              getAvg:   d => d.estAvg, numAnalysts: d => d.numAnalysts },
            { key: 'ni',   label: 'Earnings',   color: '#06b6d4', fill: 'rgba(6,182,212,0.12)',
              getValue: d => d.isActual && d.netIncome != null ? d.netIncome : d.netIncomeAvg,
              getAvg:   d => d.netIncomeAvg, numAnalysts: () => null },
            { key: 'eb',   label: 'EBITDA',     color: '#f59e0b', fill: 'rgba(245,158,11,0.12)',
              getValue: d => d.isActual && d.ebitda    != null ? d.ebitda    : d.ebitdaAvg,
              getAvg:   d => d.ebitdaAvg, numAnalysts: () => null },
          ];

          // Only show series that have at least 2 non-null data points AND are toggled on
          const availableSeries = ALL_SERIES.filter(s => rows.filter(d => s.getValue(d) != null).length >= 2);
          const series = availableSeries.filter(s => activeForecastSeries.includes(s.key));

          // If nothing active, fall back to all available
          const activeSeries = series.length > 0 ? series : availableSeries;

          const allVals: number[] = [];
          rows.forEach(d => {
            activeSeries.forEach(s => { const v = s.getValue(d); if (v != null) allVals.push(v); });
          });
          if (allVals.length === 0) return (
            <Text style={[styles.emptyText, { marginTop: 0 }]}>No estimate data available</Text>
          );

          const chartW = SCREEN_WIDTH - 40;
          const chartH = 240;
          const PAD_T = 24, PAD_B = 36, PAD_L = 6, PAD_R = 54;
          const plotW = chartW - PAD_L - PAD_R;
          const plotH = chartH - PAD_T - PAD_B;

          const rawMin = Math.min(0, ...allVals);
          const rawMax = Math.max(...allVals);
          const span   = rawMax - rawMin || 1;
          const minY   = rawMin - span * 0.02;
          const maxY   = rawMax + span * 0.18;
          const yRange = maxY - minY;

          const xP = (i: number) => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
          const yP = (v: number) => PAD_T + plotH * (1 - (v - minY) / yRange);
          const buildPath = (pts: { x: number; y: number }[]) =>
            pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
          const buildArea = (pts: { x: number; y: number }[], baseY: number) => {
            if (pts.length < 2) return '';
            return [
              `M ${pts[0].x.toFixed(1)} ${baseY.toFixed(1)}`,
              ...pts.map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
              `L ${pts[pts.length - 1].x.toFixed(1)} ${baseY.toFixed(1)}`,
              'Z',
            ].join(' ');
          };

          const lastActual = rows.reduce<number>((acc, d, i) => d.isActual ? i : acc, -1);
          const dividerX   = lastActual >= 0 ? xP(lastActual) : null;
          const baseY      = yP(0) > chartH - PAD_B ? chartH - PAD_B : yP(0);

          const GRID = 4;
          const gridLines = Array.from({ length: GRID + 1 }, (_, i) => ({
            y: yP(minY + (yRange / GRID) * i),
            v: minY + (yRange / GRID) * i,
          }));
          const fmtAxis = (v: number) => {
            const abs = Math.abs(v);
            if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
            if (abs >= 1e9)  return `${(v / 1e9).toFixed(0)}B`;
            if (abs >= 1e6)  return `${(v / 1e6).toFixed(0)}M`;
            return v.toFixed(0);
          };

          // Latest estimate values for summary header
          const lastEst = rows.filter(d => !d.isActual).slice(-1)[0] ?? rows[rows.length - 1];

          return (
            <View style={[styles.fundCard, { padding: 0, overflow: 'hidden' }]}>
              {/* Summary header */}
              <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
                {lastEst && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ color: '#64748b', fontSize: 11 }}>
                      {lastEst.year} estimates
                    </Text>
                    <Text style={{ color: '#475569', fontSize: 10 }}>Analysts</Text>
                  </View>
                )}
                {ALL_SERIES.map(s => {
                  const avg = lastEst ? s.getAvg(lastEst) : null;
                  if (avg == null) return null;
                  return (
                    <View key={s.key} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text style={{ color: '#94a3b8', fontSize: 11 }}>{s.label}</Text>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <Text style={{ color: s.color, fontSize: 11, fontWeight: '600' }}>{fmtShort(avg)} /yr</Text>
                        <Text style={{ color: '#475569', fontSize: 11 }}>
                          {lastEst && s.numAnalysts(lastEst) != null ? String(s.numAnalysts(lastEst)) : '—'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Chart */}
              <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                <Svg width={chartW} height={chartH}>
                  {/* Past shaded region */}
                  {dividerX != null && (
                    <SvgPath
                      d={`M ${PAD_L} ${PAD_T} L ${dividerX} ${PAD_T} L ${dividerX} ${chartH - PAD_B} L ${PAD_L} ${chartH - PAD_B} Z`}
                      fill="rgba(255,255,255,0.03)"
                    />
                  )}
                  {/* Grid lines */}
                  {gridLines.map((g, i) => (
                    <SvgLine key={`g${i}`} x1={PAD_L} y1={g.y} x2={PAD_L + plotW} y2={g.y} stroke="#1e293b" strokeWidth={1} />
                  ))}
                  {/* Y-axis labels */}
                  {gridLines.map((g, i) => (
                    <SvgText key={`yt${i}`} x={PAD_L + plotW + 4} y={g.y + 4} fontSize={8} fill="#475569">{fmtAxis(g.v)}</SvgText>
                  ))}
                  {/* Area fills */}
                  {activeSeries.map(s => {
                    const pts = rows.map((d, i) => { const v = s.getValue(d); return v != null ? { x: xP(i), y: yP(v) } : null; })
                      .filter((p): p is { x: number; y: number } => p != null);
                    return pts.length >= 2
                      ? <SvgPath key={`area${s.key}`} d={buildArea(pts, baseY)} fill={s.fill} />
                      : null;
                  })}
                  {/* Past/Forecast divider */}
                  {dividerX != null && (
                    <>
                      <SvgLine x1={dividerX} y1={PAD_T - 10} x2={dividerX} y2={chartH - PAD_B} stroke="#334155" strokeWidth={1} strokeDasharray="4,3" />
                      <SvgText x={dividerX - 26} y={PAD_T - 2} fontSize={8} fill="#475569">Past</SvgText>
                      <SvgText x={dividerX + 4}  y={PAD_T - 2} fontSize={8} fill="#818cf8">Forecasts</SvgText>
                    </>
                  )}
                  {/* Lines */}
                  {activeSeries.map(s => {
                    const pts = rows.map((d, i) => { const v = s.getValue(d); return v != null ? { x: xP(i), y: yP(v) } : null; })
                      .filter((p): p is { x: number; y: number } => p != null);
                    return pts.length >= 2
                      ? <SvgPath key={`line${s.key}`} d={buildPath(pts)} stroke={s.color} strokeWidth={2} fill="none" />
                      : null;
                  })}
                  {/* End-point dot for each series */}
                  {activeSeries.map(s => {
                    const lastD = [...rows].reverse().find(d => s.getValue(d) != null);
                    if (!lastD) return null;
                    const lastI = rows.lastIndexOf(lastD);
                    const v = s.getValue(lastD);
                    if (v == null) return null;
                    return <SvgCircle key={`dot${s.key}`} cx={xP(lastI)} cy={yP(v)} r={5} fill={s.color} stroke="#0f172a" strokeWidth={1.5} />;
                  })}
                  {/* X-axis labels */}
                  {rows.map((d, i) => (
                    <SvgText key={`xl${i}`} x={xP(i)} y={chartH - PAD_B + 14}
                      textAnchor="middle" fontSize={8} fill={d.isActual ? '#64748b' : '#818cf8'}>
                      {d.year}
                    </SvgText>
                  ))}
                </Svg>
              </View>

              {/* Legend toggles */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 14, paddingTop: 4 }}>
                {ALL_SERIES.filter(s => rows.filter(d => s.getValue(d) != null).length >= 2).map(s => {
                  const active = activeForecastSeries.includes(s.key);
                  return (
                    <TouchableOpacity
                      key={s.key}
                      onPress={() => setActiveForecastSeries(prev =>
                        prev.includes(s.key)
                          ? prev.length > 1 ? prev.filter(k => k !== s.key) : prev
                          : [...prev, s.key]
                      )}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5,
                        borderRadius: 20, borderWidth: 1,
                        borderColor: active ? s.color : '#334155',
                        backgroundColor: active ? s.color + '18' : 'transparent' }}
                    >
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? s.color : '#334155' }} />
                      <Text style={{ color: active ? s.color : '#475569', fontSize: 11, fontWeight: '600' }}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
                <Text style={{ color: '#334155', fontSize: 10, alignSelf: 'center', marginLeft: 4 }}>Source: FMP</Text>
              </View>

              {/* Year-by-year values table */}
              <View style={{ paddingHorizontal: 12, paddingBottom: 14 }}>
                {/* Header row */}
                <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1e293b', paddingBottom: 4, marginBottom: 4 }}>
                  <Text style={{ color: '#475569', fontSize: 10, width: 44 }}>Year</Text>
                  <Text style={{ color: '#3b82f6', fontSize: 10, flex: 1, textAlign: 'right' }}>Revenue</Text>
                  <Text style={{ color: '#06b6d4', fontSize: 10, flex: 1, textAlign: 'right' }}>Earnings</Text>
                  <Text style={{ color: '#f59e0b', fontSize: 10, flex: 1, textAlign: 'right' }}>EBITDA</Text>
                </View>
                {rows.map(d => {
                  const rev = d.isActual && d.revenue != null ? d.revenue : d.estAvg;
                  const ni  = d.isActual && d.netIncome != null ? d.netIncome : d.netIncomeAvg;
                  const eb  = d.isActual && d.ebitda != null ? d.ebitda : d.ebitdaAvg;
                  return (
                    <View key={d.year} style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
                      <View style={{ width: 44, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Text style={{ color: d.isActual ? '#64748b' : '#818cf8', fontSize: 10 }}>{d.year}</Text>
                        {!d.isActual && <Text style={{ color: '#818cf8', fontSize: 8 }}>E</Text>}
                      </View>
                      <Text style={{ color: rev != null ? '#3b82f6' : '#334155', fontSize: 10, flex: 1, textAlign: 'right' }}>{fmtShort(rev)}</Text>
                      <Text style={{ color: ni  != null ? '#06b6d4' : '#334155', fontSize: 10, flex: 1, textAlign: 'right' }}>{fmtShort(ni)}</Text>
                      <Text style={{ color: eb  != null ? '#f59e0b' : '#334155', fontSize: 10, flex: 1, textAlign: 'right' }}>{fmtShort(eb)}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })() : (
          !revenueEstimatesLoading && <Text style={[styles.emptyText, { marginTop: 0 }]}>No estimate data available</Text>
        )}

        {/* Transações de Insiders */}
        {insiderLoading ? (
          <ActivityIndicator color="#6366f1" style={{ marginVertical: 16 }} />
        ) : insiderTx.length > 0 ? (
          <>
            <Text style={styles.fundSection}>Insider Transactions</Text>
            <View style={[styles.fundCard, { padding: 0, overflow: 'hidden' }]}>
              {insiderTx.map((t, i) => (
                <View key={`${t.date}-${i}`} style={[styles.gradeRow, i > 0 && { borderTopWidth: 1, borderTopColor: '#262d33' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gradeCompany} numberOfLines={1}>{t.name || '—'}</Text>
                    {t.role ? <Text style={styles.gradeDate}>{t.role}</Text> : null}
                    <Text style={styles.gradeDate}>
                      {t.date ? new Date(t.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ color: t.type === 'buy' ? '#22c55e' : '#ef4444', fontWeight: '700', fontSize: 13 }}>
                      {t.type === 'buy' ? '▲ Buy' : '▼ Sell'}
                    </Text>
                    <Text style={[styles.gradeTag, { color: '#f8fafc' }]}>
                      {t.shares > 0 ? `${t.shares.toLocaleString('en-US')} shares` : ''}
                      {t.price > 0 ? ` @ $${t.price.toFixed(2)}` : ''}
                    </Text>
                    {(() => {
                        const displayVal = t.value > 0 ? t.value : t.shares * t.price;
                        return displayVal > 0 ? (
                          <Text style={[styles.gradeDate, { color: t.type === 'buy' ? '#22c55e' : '#ef4444' }]}>
                            {displayVal >= 1e9 ? `$${(displayVal / 1e9).toFixed(2)}B`
                              : displayVal >= 1e6 ? `$${(displayVal / 1e6).toFixed(2)}M`
                              : `$${Math.round(displayVal).toLocaleString('en-US')}`}
                          </Text>
                        ) : null;
                      })()}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {!analystConsensus && !analystLoading && (
          <Text style={styles.emptyText}>No analyst data available</Text>
        )}

        <View style={{ height: 30 }} />
      </>
    );
  };

  const FundamentosTab = () => {
    // ---- ETF layout ----
    if (isEtf) {
      if (etfLoading && !etfInfo) return <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />;
      const e = etfInfo;
      const f = fundamentals;
      const fmtPctEtf = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(2)}%`;
      const fmtBigEtf = (v: number | null) => {
        if (v == null) return '—';
        if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
        if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
        if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
        return `$${v.toFixed(0)}`;
      };

      return (
        <>
          {/* Description */}
          {f?.description ? (
            <View style={styles.descCard}>
              <Text style={styles.descText} numberOfLines={descExpanded ? undefined : 3}>{f.description}</Text>
              <TouchableOpacity onPress={() => setDescExpanded((v) => !v)} style={styles.descToggle}>
                <Text style={styles.descToggleTxt}>{descExpanded ? '− Less' : '+ More'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Data */}
          <Text style={styles.fundSection}>Data</Text>
          <View style={styles.fundCard}>
            {renderFundRow('TER (expense ratio)', e?.expenseRatio != null ? fmtPctEtf(e.expenseRatio) : '—')}
            {renderFundRow('Fund volume (AUM)', fmtBigEtf(f?.marketCap ?? null))}
            {renderFundRow('Dividend Yield', fmtPctEtf(f?.dividendYield != null ? f.dividendYield * dividendNetMultiplier : null))}
            {renderFundRow('Issuer', e?.family ?? '—')}
            {renderFundRow('Inception date', (() => {
              if (e?.inceptionDate) return e.inceptionDate;
              if (quote?.firstTradeDate) return new Date(quote.firstTradeDate * 1000).toISOString().slice(0, 10);
              return '—';
            })())}
            {(() => {
              if (!e?.expenseRatio) return null;
              const ter = e.expenseRatio;
              const now = Date.now();
              const buyLots = transactions.filter(t => t.symbol === symbol && t.type === 'buy');
              if (buyLots.length === 0) return null;
              const terCost = buyLots.reduce((sum, lot) => {
                const lotValue = lot.shares * lot.price;
                const days = (now - new Date(lot.date).getTime()) / (1000 * 60 * 60 * 24);
                return sum + lotValue * ter * (days / 365);
              }, 0);
              if (terCost <= 0) return null;
              const suffix = terCost >= 1000 ? `${(terCost / 1000).toFixed(2)}K` : terCost.toFixed(2);
              return renderFundRow('TER cost (est.)', `≈ ${currencySymbol}${suffix}`, false);
            })()}
          </View>

          {/* Market */}
          {f && (
            <>
              <Text style={styles.fundSection}>Market</Text>
              <View style={styles.fundCard}>
                {renderFundRow('Beta', f.beta != null ? f.beta.toFixed(2) : '—')}
                {renderFundRow('Avg. Volume', f.averageVolume != null ? fmtBigEtf(f.averageVolume) : '—')}
                {e?.holdingsTurnover != null && renderFundRow('Holdings turnover', fmtPctEtf(e.holdingsTurnover))}
              </View>
            </>
          )}

          {/* Top Holdings */}
          {e && e.holdings.length > 0 && (
            <>
              <Text style={styles.fundSection}>Top Holdings</Text>
              <View style={styles.fundCard}>
                {e.holdings.slice(0, 10).map((h, idx) => (
                  <View key={idx} style={{ marginBottom: idx < Math.min(e.holdings.length, 10) - 1 ? 10 : 0, paddingHorizontal: 16, paddingTop: idx === 0 ? 12 : 0, paddingBottom: idx === Math.min(e.holdings.length, 10) - 1 ? 12 : 0 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: '#f1f5f9', fontSize: 13, flex: 1, paddingRight: 8 }} numberOfLines={1}>{h.name}</Text>
                      <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600' }}>{(h.pct * 100).toFixed(2)}%</Text>
                    </View>
                    <View style={{ height: 3, backgroundColor: '#1e293b', borderRadius: 2 }}>
                      <View style={{ height: 3, width: `${Math.min(h.pct * 100 / ((e.holdings[0]?.pct ?? 0.1) * 100) * 100, 100)}%`, backgroundColor: '#6366f1', borderRadius: 2 }} />
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Annual Returns */}
          {e && e.annualReturns.length > 0 && (() => {
            const returns = e.annualReturns;
            const maxAbs = Math.max(...returns.map((r) => Math.abs(r.value)), 0.01);
            return (
              <>
                <Text style={styles.fundSection}>Annual Returns</Text>
                <View style={styles.fundCard}>
                  {returns.map((r, idx) => {
                    const positive = r.value >= 0;
                    const barPct = Math.abs(r.value) / maxAbs;
                    return (
                      <View key={r.year} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: idx < returns.length - 1 ? 8 : 0, paddingHorizontal: 16, paddingTop: idx === 0 ? 12 : 0, paddingBottom: idx === returns.length - 1 ? 12 : 0 }}>
                        <Text style={{ color: '#64748b', fontSize: 12, width: 36 }}>{r.year}</Text>
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                          <View style={{ flex: 1, height: 14, backgroundColor: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                            <View style={{
                              position: 'absolute',
                              left: positive ? '50%' : `${(0.5 - barPct * 0.5) * 100}%`,
                              width: `${barPct * 50}%`,
                              height: 14,
                              backgroundColor: positive ? '#22c55e' : '#ef4444',
                              borderRadius: 3,
                            }} />
                            <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: '#334155' }} />
                          </View>
                        </View>
                        <Text style={{ color: positive ? '#22c55e' : '#ef4444', fontSize: 12, fontWeight: '600', width: 56, textAlign: 'right' }}>
                          {positive ? '+' : ''}{(r.value * 100).toFixed(1)}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </>
            );
          })()}

          {/* Sector Weighting */}
          {e && e.sectorWeighting.length > 0 && (
            <>
              <Text style={styles.fundSection}>Sector Weighting</Text>
              <View style={styles.fundCard}>
                {e.sectorWeighting.slice(0, 10).map((s, idx) => (
                  <View key={idx} style={{ marginBottom: idx < e.sectorWeighting.length - 1 ? 10 : 0, paddingHorizontal: 16, paddingTop: idx === 0 ? 12 : 0, paddingBottom: idx === e.sectorWeighting.length - 1 ? 12 : 0 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: '#f1f5f9', fontSize: 13, flex: 1, paddingRight: 8 }} numberOfLines={1}>{s.sector}</Text>
                      <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600' }}>{(s.weight * 100).toFixed(2)}%</Text>
                    </View>
                    <View style={{ height: 3, backgroundColor: '#0f172a', borderRadius: 2 }}>
                      <View style={{ height: 3, width: `${Math.min(s.weight / (e.sectorWeighting[0]?.weight ?? 0.01) * 100, 100)}%`, backgroundColor: '#6366f1', borderRadius: 2 }} />
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={{ height: 24 }} />
        </>
      );
    }

    // ---- Stock layout (original) ----
    if (fundLoading) return <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />;
    if (!fundamentals) return <Text style={styles.emptyText}>No data available</Text>;
    const f = fundamentals;
    return (
      <>
        {f.description ? (
          <View style={styles.descCard}>
            <Text style={styles.descText} numberOfLines={descExpanded ? undefined : 4}>{f.description}</Text>
            <TouchableOpacity onPress={() => setDescExpanded((v) => !v)} style={styles.descToggle}>
              <Text style={styles.descToggleTxt}>{descExpanded ? '− Less' : '+ More'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {(f.sector || f.industry) ? (
          <View style={styles.tagsRow}>
            {f.sector   ? <View style={styles.tag}><Text style={styles.tagTxt}>{f.sector}</Text></View>   : null}
            {f.industry ? <View style={styles.tag}><Text style={styles.tagTxt}>{f.industry}</Text></View> : null}
          </View>
        ) : null}

        <Text style={styles.fundSection}>Investment Decision</Text>
        <View style={[styles.fundCard, { padding: 14 }]}> 
          {investmentDecision.ready ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 4 }}>Entry Summary</Text>
                  <Text style={{ color: '#64748b', fontSize: 12, lineHeight: 18 }}>
                    Combines valuation, scenarios, and short-term technicals into an actionable view.
                  </Text>
                </View>
                <View style={{ backgroundColor: investmentDecision.actionBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' }}>
                  <Text style={{ color: investmentDecision.actionColor, fontSize: 12, fontWeight: '700' }}>{investmentDecision.action}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2a2a2a' }}>
                  <Text style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>DCF Fair Value</Text>
                  <Text style={{ color: '#e2e8f0', fontSize: 15, fontWeight: '700' }}>
                    {investmentDecision.dcfFairValue != null ? `${nativeCurrencySymbol}${investmentDecision.dcfFairValue.toFixed(2)}` : '—'}
                  </Text>
                  <Text style={{ color: investmentDecision.dcfGapPct != null && investmentDecision.dcfGapPct >= 0 ? '#86efac' : investmentDecision.dcfGapPct != null ? '#fca5a5' : '#94a3b8', fontSize: 11, marginTop: 3 }}>
                    {investmentDecision.dcfFairValue != null
                      ? `${investmentDecision.dcfGapPct != null ? `${investmentDecision.dcfGapPct >= 0 ? '+' : ''}${investmentDecision.dcfGapPct.toFixed(1)}% vs current` : 'DCF available'} · ${dcfResult?.source === 'analyst' ? 'Analyst inputs' : 'Historical inputs'}`
                      : 'DCF unavailable'}
                  </Text>
                </View>

                <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2a2a2a' }}>
                  <Text style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Scenario Expected Value</Text>
                  <Text style={{ color: '#e2e8f0', fontSize: 15, fontWeight: '700' }}>
                    {investmentDecision.scenarioExpectedValue != null ? `${nativeCurrencySymbol}${investmentDecision.scenarioExpectedValue.toFixed(2)}` : '—'}
                  </Text>
                  <Text style={{ color: investmentDecision.valuationGapPct != null && investmentDecision.valuationGapPct >= 0 ? '#86efac' : '#fca5a5', fontSize: 11, marginTop: 3 }}>
                    {investmentDecision.valuationGapPct != null ? `${investmentDecision.valuationGapPct >= 0 ? '+' : ''}${investmentDecision.valuationGapPct.toFixed(1)}% vs current` : 'No scenario weighting yet'}
                  </Text>
                </View>

                <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2a2a2a' }}>
                  <Text style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Technical Timing</Text>
                  <Text style={{ color: '#e2e8f0', fontSize: 15, fontWeight: '700' }}>
                    {investmentDecision.technicalHeadline}
                  </Text>
                  <Text style={{ color: investmentDecision.macdHist != null && investmentDecision.macdHist >= 0 ? '#86efac' : investmentDecision.macdHist != null ? '#fca5a5' : '#94a3b8', fontSize: 11, marginTop: 3 }}>
                    {investmentDecision.technicalDetail}
                  </Text>
                </View>
              </View>

              <View style={{ marginBottom: 12 }}>
                <View style={{ backgroundColor: '#18181b', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2a2a2a' }}>
                  <Text style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Buy Zone</Text>
                  <Text style={{ color: '#e2e8f0', fontSize: 15, fontWeight: '700' }}>
                    {investmentDecision.zoneLow != null && investmentDecision.zoneHigh != null
                      ? `${nativeCurrencySymbol}${investmentDecision.zoneLow.toFixed(2)} – ${nativeCurrencySymbol}${investmentDecision.zoneHigh.toFixed(2)}`
                      : '—'}
                  </Text>
                  <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>
                    {investmentDecision.sma50 != null || investmentDecision.sma200 != null ? 'Built from dynamic support plus the current decision value' : 'Not enough support data'}
                  </Text>
                </View>
              </View>

              {displayScenarioSummary && (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {([
                    { key: 'bear', label: 'Bear', color: '#ef4444', value: displayScenarioSummary.bearPriceTarget, prob: displayScenarioSummary.bearProbability },
                    { key: 'base', label: 'Base', color: '#60a5fa', value: displayScenarioSummary.basePriceTarget, prob: displayScenarioSummary.baseProbability },
                    { key: 'bull', label: 'Bull', color: '#22c55e', value: displayScenarioSummary.bullPriceTarget, prob: displayScenarioSummary.bullProbability },
                  ] as const).map((item) => (
                    <View key={item.key} style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2a2a2a' }}>
                      <Text style={{ color: item.color, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>{item.label.toUpperCase()}</Text>
                      <Text style={{ color: '#e2e8f0', fontSize: 14, fontWeight: '700' }}>
                        {item.value != null ? `${nativeCurrencySymbol}${item.value.toFixed(2)}` : '—'}
                      </Text>
                      <Text style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{item.prob}% scenario weight</Text>
                      <Text style={{ color: '#475569', fontSize: 10, marginTop: 2 }}>
                        {item.value != null ? `Contribution ${nativeCurrencySymbol}${((item.value * item.prob) / 100).toFixed(2)}` : 'No contribution'}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={{ backgroundColor: '#18181b', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#2a2a2a' }}>
                <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '700', marginBottom: 8 }}>Why this does or does not make sense now</Text>
                {investmentDecision.reasons.length > 0 ? investmentDecision.reasons.slice(0, 4).map((reason, idx) => (
                  <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: idx < Math.min(investmentDecision.reasons.length, 4) - 1 ? 6 : 0 }}>
                    <Text style={{ color: '#6366f1', fontSize: 12, marginTop: 1 }}>•</Text>
                    <Text style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 18, flex: 1 }}>{reason}</Text>
                  </View>
                )) : (
                  <Text style={{ color: '#64748b', fontSize: 12 }}>Generate valuation and technical data first to build a compact decision view.</Text>
                )}
              </View>

              <View style={{ marginTop: 12, backgroundColor: '#18181b', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden' }}>
                <TouchableOpacity
                  style={{ paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  onPress={() => setDecisionMathExpanded(v => !v)}
                >
                  <View>
                    <Text style={{ color: '#cbd5e1', fontSize: 12, fontWeight: '700' }}>How these calculations work</Text>
                    <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>Bear / Base / Bull, expected value, fair value, and buy zone</Text>
                  </View>
                  <Ionicons name={decisionMathExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#94a3b8" />
                </TouchableOpacity>

                {decisionMathExpanded && (
                  <View style={{ borderTopWidth: 1, borderTopColor: '#2a2a2a', padding: 12, gap: 10 }}>
                    {scenariosData?.probabilityMath && (
                      <>
                        <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700' }}>HEURISTIC SCENARIO WEIGHT BREAKDOWN</Text>
                        <View style={{ backgroundColor: '#111111', borderRadius: 8, padding: 10, gap: 8 }}>
                          {scenariosData.probabilityMath.factors.map((factor, idx) => (
                            <View key={`${factor.label}-${idx}`} style={{ borderBottomWidth: idx < scenariosData.probabilityMath!.factors.length - 1 ? 1 : 0, borderBottomColor: '#2a2a2a', paddingBottom: idx < scenariosData.probabilityMath!.factors.length - 1 ? 8 : 0, marginBottom: idx < scenariosData.probabilityMath!.factors.length - 1 ? 2 : 0 }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '700', flex: 1 }}>{factor.label}</Text>
                                <Text style={{ color: '#64748b', fontSize: 11 }}>Bull {factor.bullDelta >= 0 ? '+' : ''}{factor.bullDelta} | Base {factor.baseDelta >= 0 ? '+' : ''}{factor.baseDelta} | Bear {factor.bearDelta >= 0 ? '+' : ''}{factor.bearDelta}</Text>
                              </View>
                              {factor.note ? <Text style={{ color: '#94a3b8', fontSize: 11, lineHeight: 16 }}>{factor.note}</Text> : null}
                            </View>
                          ))}
                          <Text style={{ color: '#60a5fa', fontSize: 12, marginTop: 2 }}>
                            Default heuristic scores = Bull {scenariosData.probabilityMath.bullScore} + Base {scenariosData.probabilityMath.baseScore} + Bear {scenariosData.probabilityMath.bearScore}
                          </Text>
                        </View>

                        <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700' }}>EDITABLE SIMULATION</Text>
                        <View style={{ backgroundColor: '#111111', borderRadius: 8, padding: 10, gap: 10 }}>
                          <Text style={{ color: '#94a3b8', fontSize: 11 }}>Edit the scores below to test your own scenario weighting. These are heuristic weights, not calibrated statistical probabilities.</Text>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: '#fca5a5', fontSize: 11, marginBottom: 4 }}>Bear score</Text>
                              <TextInput
                                style={[styles.modalInput, { marginBottom: 0, paddingVertical: 10, backgroundColor: '#18181b', borderColor: '#3f3f46' }]}
                                keyboardType="numeric"
                                value={simBearScore}
                                onChangeText={(t) => setSimBearScore(t.replace(/[^0-9]/g, ''))}
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: '#93c5fd', fontSize: 11, marginBottom: 4 }}>Base score</Text>
                              <TextInput
                                style={[styles.modalInput, { marginBottom: 0, paddingVertical: 10, backgroundColor: '#18181b', borderColor: '#3f3f46' }]}
                                keyboardType="numeric"
                                value={simBaseScore}
                                onChangeText={(t) => setSimBaseScore(t.replace(/[^0-9]/g, ''))}
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: '#86efac', fontSize: 11, marginBottom: 4 }}>Bull score</Text>
                              <TextInput
                                style={[styles.modalInput, { marginBottom: 0, paddingVertical: 10, backgroundColor: '#18181b', borderColor: '#3f3f46' }]}
                                keyboardType="numeric"
                                value={simBullScore}
                                onChangeText={(t) => setSimBullScore(t.replace(/[^0-9]/g, ''))}
                              />
                            </View>
                          </View>

                          {simulatedProbabilityMath && (
                            <>
                              <View style={{ flexDirection: 'row', gap: 8 }}>
                                <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#2a2a2a' }}>
                                  <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '700' }}>BEAR</Text>
                                  <Text style={{ color: '#e2e8f0', fontSize: 14, fontWeight: '700' }}>{simulatedProbabilityMath.bearProb}%</Text>
                                </View>
                                <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#2a2a2a' }}>
                                  <Text style={{ color: '#93c5fd', fontSize: 11, fontWeight: '700' }}>BASE</Text>
                                  <Text style={{ color: '#e2e8f0', fontSize: 14, fontWeight: '700' }}>{simulatedProbabilityMath.baseProb}%</Text>
                                </View>
                                <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#2a2a2a' }}>
                                  <Text style={{ color: '#86efac', fontSize: 11, fontWeight: '700' }}>BULL</Text>
                                  <Text style={{ color: '#e2e8f0', fontSize: 14, fontWeight: '700' }}>{simulatedProbabilityMath.bullProb}%</Text>
                                </View>
                              </View>
                              <Text style={{ color: '#60a5fa', fontSize: 12 }}>
                                Formula: scenario weight = score / (bull + base + bear), with a 10%–65% clamp per scenario.
                              </Text>
                              <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '700' }}>
                                Simulated expected value = {simulatedProbabilityMath.expectedValue != null ? `${nativeCurrencySymbol}${simulatedProbabilityMath.expectedValue.toFixed(2)}` : '—'}
                              </Text>
                            </>
                          )}
                        </View>
                      </>
                    )}

                    {scenariosData && (
                      <>
                        <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700' }}>SCENARIOS</Text>
                        <View style={{ backgroundColor: '#111111', borderRadius: 8, padding: 10, gap: 6 }}>
                          <Text style={{ color: '#cbd5e1', fontSize: 12 }}>Bear target = {scenariosData.bear.priceTarget != null ? `${nativeCurrencySymbol}${scenariosData.bear.priceTarget.toFixed(2)}` : '—'} × weight {displayScenarioSummary?.bearProbability ?? scenariosData.bear.probability}%</Text>
                          <Text style={{ color: '#cbd5e1', fontSize: 12 }}>Base target = {scenariosData.base.priceTarget != null ? `${nativeCurrencySymbol}${scenariosData.base.priceTarget.toFixed(2)}` : '—'} × weight {displayScenarioSummary?.baseProbability ?? scenariosData.base.probability}%</Text>
                          <Text style={{ color: '#cbd5e1', fontSize: 12 }}>Bull target = {scenariosData.bull.priceTarget != null ? `${nativeCurrencySymbol}${scenariosData.bull.priceTarget.toFixed(2)}` : '—'} × weight {displayScenarioSummary?.bullProbability ?? scenariosData.bull.probability}%</Text>
                          <Text style={{ color: '#60a5fa', fontSize: 12, marginTop: 2 }}>
                            Expected value = ({displayScenarioSummary?.bearProbability ?? scenariosData.bear.probability}% × {scenariosData.bear.priceTarget?.toFixed(2) ?? '—'}) + ({displayScenarioSummary?.baseProbability ?? scenariosData.base.probability}% × {scenariosData.base.priceTarget?.toFixed(2) ?? '—'}) + ({displayScenarioSummary?.bullProbability ?? scenariosData.bull.probability}% × {scenariosData.bull.priceTarget?.toFixed(2) ?? '—'})
                          </Text>
                          <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '700' }}>
                            = {displayScenarioSummary?.expectedValue != null ? `${nativeCurrencySymbol}${displayScenarioSummary.expectedValue.toFixed(2)}` : '—'}
                          </Text>
                        </View>

                        <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700' }}>SCENARIO JUSTIFICATIONS</Text>
                        <View style={{ gap: 8 }}>
                          {([
                            { key: 'bull', label: 'Bull case', color: '#22c55e', soft: '#86efac', scenario: scenariosData.bull, weight: displayScenarioSummary?.bullProbability ?? scenariosData.bull.probability },
                            { key: 'base', label: 'Base case', color: '#60a5fa', soft: '#93c5fd', scenario: scenariosData.base, weight: displayScenarioSummary?.baseProbability ?? scenariosData.base.probability },
                            { key: 'bear', label: 'Bear case', color: '#ef4444', soft: '#fca5a5', scenario: scenariosData.bear, weight: displayScenarioSummary?.bearProbability ?? scenariosData.bear.probability },
                          ] as const).map((entry) => {
                            const isOpen = expandedScenarioCases[entry.key];
                            const contribution = entry.scenario.priceTarget != null ? (entry.scenario.priceTarget * entry.weight) / 100 : null;
                            return (
                              <View key={entry.key} style={{ backgroundColor: '#111111', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden' }}>
                                <TouchableOpacity
                                  style={{ paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
                                  onPress={() => setExpandedScenarioCases((prev) => ({ ...prev, [entry.key]: !prev[entry.key] }))}
                                >
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ color: entry.color, fontSize: 12, fontWeight: '700' }}>{entry.label.toUpperCase()}</Text>
                                    <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2 }}>
                                      Target {entry.scenario.priceTarget != null ? `${nativeCurrencySymbol}${entry.scenario.priceTarget.toFixed(2)}` : '—'} | Weight {entry.weight}%
                                    </Text>
                                    <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                                      Contribution {contribution != null ? `${nativeCurrencySymbol}${contribution.toFixed(2)}` : '—'}
                                    </Text>
                                  </View>
                                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#94a3b8" />
                                </TouchableOpacity>

                                {isOpen && (
                                  <View style={{ borderTopWidth: 1, borderTopColor: '#2a2a2a', padding: 10, gap: 8 }}>
                                    {entry.scenario.items.map((item, idx) => (
                                      <View key={`${entry.key}-${idx}`} style={{ backgroundColor: '#18181b', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#2a2a2a' }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                                          <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '700', flex: 1 }}>{item.driver}</Text>
                                          <View style={{ alignItems: 'flex-end', minWidth: 54 }}>
                                            <View style={{ width: 48, height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, overflow: 'hidden', marginBottom: 3 }}>
                                              <View style={{ width: `${item.confidence}%`, height: '100%', backgroundColor: entry.color, borderRadius: 2 }} />
                                            </View>
                                            <Text style={{ color: entry.soft, fontSize: 10 }}>{item.confidence}%</Text>
                                          </View>
                                        </View>
                                        {item.evidence.map((ev, ei) => (
                                          <View key={`${entry.key}-${idx}-${ei}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: ei === 0 ? 0 : 4 }}>
                                            <Text style={{ color: entry.color, fontSize: 11, marginTop: 1 }}>•</Text>
                                            <Text style={{ color: '#94a3b8', fontSize: 12, lineHeight: 17, flex: 1 }}>{ev}</Text>
                                          </View>
                                        ))}
                                      </View>
                                    ))}
                                  </View>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      </>
                    )}

                    <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700' }}>VALUATION</Text>
                    <View style={{ backgroundColor: '#111111', borderRadius: 8, padding: 10, gap: 6 }}>
                      <Text style={{ color: '#cbd5e1', fontSize: 12 }}>
                        DCF fair value = {dcfResult?.fairValue != null ? `${nativeCurrencySymbol}${dcfResult.fairValue.toFixed(2)}` : 'unavailable'}
                      </Text>
                      <Text style={{ color: '#cbd5e1', fontSize: 12 }}>
                        Scenario expected value = {displayScenarioSummary?.expectedValue != null ? `${nativeCurrencySymbol}${displayScenarioSummary.expectedValue.toFixed(2)}` : 'unavailable'}
                      </Text>
                      <Text style={{ color: '#cbd5e1', fontSize: 12 }}>
                        Decision value used = {investmentDecision.decisionValue != null ? `${nativeCurrencySymbol}${investmentDecision.decisionValue.toFixed(2)}` : 'unavailable'}
                      </Text>
                      <Text style={{ color: '#60a5fa', fontSize: 12 }}>
                        Valuation gap = ((decision value / current price) - 1) x 100
                      </Text>
                      <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '700' }}>
                        = {investmentDecision.decisionValue != null ? `((${investmentDecision.decisionValue.toFixed(2)} / ${nativePrice.toFixed(2)}) - 1) x 100 = ${investmentDecision.valuationGapPct?.toFixed(1) ?? '—'}%` : '—'}
                      </Text>
                    </View>

                    <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700' }}>BUY ZONE / TIMING</Text>
                    <View style={{ backgroundColor: '#111111', borderRadius: 8, padding: 10, gap: 6 }}>
                      <Text style={{ color: '#cbd5e1', fontSize: 12 }}>RSI = {investmentDecision.rsi != null ? investmentDecision.rsi.toFixed(1) : '—'} | MACD hist = {investmentDecision.macdHist != null ? investmentDecision.macdHist.toFixed(3) : '—'}</Text>
                      <Text style={{ color: '#cbd5e1', fontSize: 12 }}>SMA50 = {investmentDecision.sma50 != null ? `${nativeCurrencySymbol}${investmentDecision.sma50.toFixed(2)}` : '—'} | SMA200 = {investmentDecision.sma200 != null ? `${nativeCurrencySymbol}${investmentDecision.sma200.toFixed(2)}` : '—'}</Text>
                      <Text style={{ color: '#60a5fa', fontSize: 12 }}>Buy zone = min(SMA50, SMA200, base case, fair value) ... max(SMA50, SMA200, base case, fair value)</Text>
                      <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '700' }}>
                        = {investmentDecision.zoneLow != null && investmentDecision.zoneHigh != null ? `${nativeCurrencySymbol}${investmentDecision.zoneLow.toFixed(2)} – ${nativeCurrencySymbol}${investmentDecision.zoneHigh.toFixed(2)}` : '—'}
                      </Text>
                    </View>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={{ marginTop: 12, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                onPress={loadInvestmentDecision}
              >
                <Ionicons name="refresh-outline" size={14} color="#6366f1" />
                <Text style={{ color: '#6366f1', fontSize: 13 }}>Refresh decision</Text>
              </TouchableOpacity>
            </>
          ) : decisionLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 16, gap: 10 }}>
              <ActivityIndicator color="#6366f1" />
              <Text style={{ color: '#64748b', fontSize: 13 }}>Building investment decision…</Text>
            </View>
          ) : decisionError ? (
            <>
              <Text style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{decisionError}</Text>
              <TouchableOpacity
                style={{ backgroundColor: '#6366f1', paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
                onPress={loadInvestmentDecision}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 }}
              onPress={loadInvestmentDecision}
            >
              <Ionicons name="compass-outline" size={18} color="#6366f1" />
              <Text style={{ color: '#6366f1', fontSize: 15, fontWeight: '600' }}>Generate Investment Decision</Text>
            </TouchableOpacity>
          )}
        </View>

        {isDesktop ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {/* Left column: Valuation, Growth, Market */}
            <View style={{ flex: 1 }}>
              <Text style={styles.fundSection}>Valuation</Text>
              <View style={styles.fundCard}>
                {renderFundRow('Market Cap', fmtBig(f.marketCap))}
                {renderFundRow('P/E (trailing)', fmtNum(f.trailingPE))}
                {renderFundRow('P/E (forward)', fmtNum(f.forwardPE))}
                {renderFundRow('P/B (Price/Book)', fmtNum(f.priceToBook))}
                {renderFundRow('P/S (Price/Sales)', fmtNum(f.priceToSales))}
                {renderFundRow('Enterprise Value', fmtBig(f.enterpriseValue))}
              </View>

              <Text style={styles.fundSection}>Growth</Text>
              <View style={styles.fundCard}>
                {renderFundRow('Revenue Growth (YoY)', fmtPct(f.revenueGrowth), (f.revenueGrowth ?? 0) > 0)}
                {renderFundRow('Earnings Growth (YoY)', fmtPct(f.earningsGrowth), (f.earningsGrowth ?? 0) > 0)}
                {renderFundRow('ROE', fmtPct(f.returnOnEquity))}
                {renderFundRow('ROA', fmtPct(f.returnOnAssets))}
                {renderFundRow('ROIC', fmtPct(f.roic), f.roic != null && f.wacc != null ? f.roic > f.wacc : (f.roic ?? 0) > 0.10)}
                {renderFundRow('WACC', fmtPct(f.wacc))}
                {f.roic != null && f.wacc != null && (
                  renderFundRow('ROIC − WACC', fmtPct(f.roic - f.wacc), f.roic > f.wacc)
                )}
              </View>

              <Text style={styles.fundSection}>Market</Text>
              <View style={styles.fundCard}>
                {renderFundRow('Beta', fmtNum(f.beta))}
                {renderFundRow('52W High', fmtNum(f.fiftyTwoWeekHigh))}
                {renderFundRow('52W Low', fmtNum(f.fiftyTwoWeekLow))}
              </View>
            </View>

            {/* Right column: Financials, Balance Sheet, Company */}
            <View style={{ flex: 1 }}>
              <Text style={styles.fundSection}>Financials</Text>
              <View style={styles.fundCard}>
                {renderFundRow('EPS (trailing)', fmtNum(f.trailingEps))}
                {renderFundRow('EPS (forward)', fmtNum(
                  f.forwardEps ?? (f.forwardPE && quote?.c ? quote.c / f.forwardPE : null)
                ))}
                {renderFundRow('Total Revenue', fmtBig(f.totalRevenue))}
                {renderFundRow('Revenue Est. (FY+1)', fmtBig(f.forwardRevenue))}
                {renderFundRow('EBITDA', fmtBig(f.ebitda))}
                {renderFundRow('EV/EBITDA', fmtNum(f.evToEbitda))}
                {renderFundRow('Gross Margin', fmtPct(f.grossMargins))}
                {renderFundRow('Operating Margin', fmtPct(f.operatingMargins))}
                {renderFundRow('Net Margin', fmtPct(f.profitMargins))}
              </View>

              <Text style={styles.fundSection}>Balance Sheet</Text>
              <View style={styles.fundCard}>
                {renderFundRow('Cash & Equivalents', fmtBig(f.totalCash))}
                {renderFundRow('Total Debt', fmtBig(f.totalDebt))}
                {renderFundRow('Debt/Equity', fmtNum(f.debtToEquity))}
                {renderFundRow('Current Ratio', fmtNum(f.currentRatio))}
              </View>

              {(f.employees != null || f.sharesOutstanding != null || f.website != null) && (
                <>
                  <Text style={styles.fundSection}>Company</Text>
                  <View style={styles.fundCard}>
                    {f.employees != null && renderFundRow('Employees', fmtBig(f.employees))}
                    {f.sharesOutstanding != null && renderFundRow('Shares Outstanding', fmtBig(f.sharesOutstanding))}
                    {f.website ? (
                      <TouchableOpacity onPress={() => Linking.openURL(f.website!)} style={styles.fundRow}>
                        <Text style={styles.fundLabel}>Website</Text>
                        <Text style={[styles.fundValue, { color: '#6366f1' }]}>{f.website}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </>
              )}
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.fundSection}>Valuation</Text>
            <View style={styles.fundCard}>
              {renderFundRow('Market Cap', fmtBig(f.marketCap))}
              {renderFundRow('P/E (trailing)', fmtNum(f.trailingPE))}
              {renderFundRow('P/E (forward)', fmtNum(f.forwardPE))}
              {renderFundRow('P/B (Price/Book)', fmtNum(f.priceToBook))}
              {renderFundRow('P/S (Price/Sales)', fmtNum(f.priceToSales))}
              {renderFundRow('Enterprise Value', fmtBig(f.enterpriseValue))}
            </View>

            <Text style={styles.fundSection}>Financials</Text>
            <View style={styles.fundCard}>
              {renderFundRow('EPS (trailing)', fmtNum(f.trailingEps))}
              {renderFundRow('EPS (forward)', fmtNum(
                f.forwardEps ?? (f.forwardPE && quote?.c ? quote.c / f.forwardPE : null)
              ))}
              {renderFundRow('Total Revenue', fmtBig(f.totalRevenue))}
              {renderFundRow('Revenue Est. (FY+1)', fmtBig(f.forwardRevenue))}
              {renderFundRow('EBITDA', fmtBig(f.ebitda))}
              {renderFundRow('EV/EBITDA', fmtNum(f.evToEbitda))}
              {renderFundRow('Gross Margin', fmtPct(f.grossMargins))}
              {renderFundRow('Operating Margin', fmtPct(f.operatingMargins))}
              {renderFundRow('Net Margin', fmtPct(f.profitMargins))}
            </View>

            <Text style={styles.fundSection}>Growth</Text>
            <View style={styles.fundCard}>
              {renderFundRow('Revenue Growth (YoY)', fmtPct(f.revenueGrowth), (f.revenueGrowth ?? 0) > 0)}
              {renderFundRow('Earnings Growth (YoY)', fmtPct(f.earningsGrowth), (f.earningsGrowth ?? 0) > 0)}
              {renderFundRow('ROE', fmtPct(f.returnOnEquity))}
              {renderFundRow('ROA', fmtPct(f.returnOnAssets))}
              {renderFundRow('ROIC', fmtPct(f.roic), f.roic != null && f.wacc != null ? f.roic > f.wacc : (f.roic ?? 0) > 0.10)}
              {renderFundRow('WACC', fmtPct(f.wacc))}
              {f.roic != null && f.wacc != null && (
                renderFundRow('ROIC − WACC', fmtPct(f.roic - f.wacc), f.roic > f.wacc)
              )}
            </View>

            <Text style={styles.fundSection}>Balance Sheet</Text>
            <View style={styles.fundCard}>
              {renderFundRow('Cash & Equivalents', fmtBig(f.totalCash))}
              {renderFundRow('Total Debt', fmtBig(f.totalDebt))}
              {renderFundRow('Debt/Equity', fmtNum(f.debtToEquity))}
              {renderFundRow('Current Ratio', fmtNum(f.currentRatio))}
            </View>

            <Text style={styles.fundSection}>Market</Text>
            <View style={styles.fundCard}>
              {renderFundRow('Beta', fmtNum(f.beta))}
              {renderFundRow('52W High', fmtNum(f.fiftyTwoWeekHigh))}
              {renderFundRow('52W Low', fmtNum(f.fiftyTwoWeekLow))}
            </View>

            {(f.employees != null || f.sharesOutstanding != null || f.website != null) && (
              <>
                <Text style={styles.fundSection}>Company</Text>
                <View style={styles.fundCard}>
                  {f.employees != null && renderFundRow('Employees', fmtBig(f.employees))}
                  {f.sharesOutstanding != null && renderFundRow('Shares Outstanding', fmtBig(f.sharesOutstanding))}
                  {f.website ? (
                    <TouchableOpacity onPress={() => Linking.openURL(f.website!)} style={styles.fundRow}>
                      <Text style={styles.fundLabel}>Website</Text>
                      <Text style={[styles.fundValue, { color: '#6366f1' }]}>{f.website}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            )}
          </>
        )}

        {/* Peer Comparison */}
        {peerLoading && !peerComparison && (
          <ActivityIndicator color="#6366f1" style={{ marginTop: 16 }} />
        )}
        {peerComparison && peerComparison.metrics.length > 0 && (() => {
          const uniquePeers = [...new Set(peerComparison.peers)].slice(0, 8);
          const fmtVal = (v: number | null, format: PeerComparison['metrics'][0]['format']) => {
            if (v === null) return '—';
            if (format === 'pct') return `${v.toFixed(2)}%`;
            if (format === 'x') return `${v.toFixed(1)}x`;
            return v.toFixed(2);
          };
          return (
            <>
              <Text style={styles.fundSection}>vs Peers</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {uniquePeers.map((p) => (
                  <View key={p} style={{ backgroundColor: '#1e293b', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: '#94a3b8', fontSize: 11 }}>{p}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.fundCard}>
                {/* Header */}
                <View style={{ flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#0f172a', paddingHorizontal: 16, paddingTop: 12 }}>
                  <Text style={{ flex: 1, color: '#64748b', fontSize: 11, fontWeight: '600' }}>METRIC</Text>
                  <Text style={{ width: 72, color: '#6366f1', fontSize: 11, fontWeight: '700', textAlign: 'right' }}>THIS</Text>
                  <Text style={{ width: 72, color: '#64748b', fontSize: 11, fontWeight: '600', textAlign: 'right' }}>PEERS MED.</Text>
                </View>
                {peerComparison.metrics.map((m, idx) => {
                  const isLast = idx === peerComparison.metrics.length - 1;
                  const stockFmt = fmtVal(m.stock, m.format);
                  const peerFmt = fmtVal(m.peerMedian, m.format);
                  // For valuation metrics (x): lower is better; for margins/growth/ROE (pct): higher is better
                  const lowerIsBetter = m.format === 'x';
                  let highlight: 'better' | 'worse' | null = null;
                  if (m.stock !== null && m.peerMedian !== null) {
                    const better = lowerIsBetter ? m.stock < m.peerMedian : m.stock > m.peerMedian;
                    highlight = better ? 'better' : 'worse';
                  }
                  return (
                    <View key={m.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#0f172a' }}>
                      <Text style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>{m.label}</Text>
                      <Text style={{ width: 72, fontSize: 12, fontWeight: '700', textAlign: 'right', color: highlight === 'better' ? '#22c55e' : highlight === 'worse' ? '#ef4444' : '#f1f5f9' }}>{stockFmt}</Text>
                      <Text style={{ width: 72, fontSize: 12, textAlign: 'right', color: '#64748b' }}>{peerFmt}</Text>
                    </View>
                  );
                })}
              </View>
            </>
          );
        })()}

        {/* Earnings */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 6 }}>
          <Text style={[styles.fundSection, { marginTop: 0, marginBottom: 0 }]}>Earnings Results</Text>
          <View style={{ flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 8, padding: 2 }}>
            <TouchableOpacity
              style={[{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 }, earningsPeriod === 'quarter' && { backgroundColor: '#6366f1' }]}
              onPress={() => setEarningsPeriod('quarter')}
            >
              <Text style={{ color: earningsPeriod === 'quarter' ? '#fff' : '#64748b', fontSize: 12, fontWeight: '600' }}>Quarterly</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 }, earningsPeriod === 'annual' && { backgroundColor: '#6366f1' }]}
              onPress={() => setEarningsPeriod('annual')}
            >
              <Text style={{ color: earningsPeriod === 'annual' ? '#fff' : '#64748b', fontSize: 12, fontWeight: '600' }}>Annual</Text>
            </TouchableOpacity>
          </View>
        </View>
        {earningsLoading
          ? <ActivityIndicator color="#6366f1" style={{ marginVertical: 12 }} />
          : earnings.length === 0
            ? <Text style={[styles.emptyText, { marginTop: 8, marginBottom: 8 }]}>No earnings data</Text>
            : (
              <View style={styles.earningsCard}>
                {/* Header */}
                <View style={[styles.earningsRow, styles.earningsHeader]}>
                  <Text style={[styles.earningsCell, styles.earningsHeaderTxt, { flex: 1.4 }]}>
                    {earningsPeriod === 'annual' ? 'Year' : 'Date'}
                  </Text>
                  <Text style={[styles.earningsCell, styles.earningsHeaderTxt]}>Revenue</Text>
                  <Text style={[styles.earningsCell, styles.earningsHeaderTxt]}>
                    {earningsPeriod === 'annual' ? 'EPS Actual' : 'EPS'}
                  </Text>
                  <Text style={[styles.earningsCell, styles.earningsHeaderTxt]}>
                    {earningsPeriod === 'annual' ? 'EPS YoY' : 'Beat/Miss'}
                  </Text>
                </View>
                {earnings.map((e, idx) => {
                  const isFuture = new Date(e.date).getTime() > Date.now();
                  // Quarterly: surprise = (actual - estimate) / |estimate|
                  // Use AV's pre-calculated surprisePct (authoritative non-GAAP adjusted basis)
                  // Fall back to recalculating from epsActual/epsEstimated if unavailable
                  const surprise = earningsPeriod === 'quarter'
                    ? (e.surprisePct ?? (e.epsActual != null && e.epsEstimated != null
                        ? ((e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated)) * 100
                        : null))
                    : null;
                  // Annual: EPS YoY = (current - prev) / |prev|  (earnings[0] = newest)
                  const prevEps = earningsPeriod === 'annual' ? earnings[idx + 1]?.epsActual ?? null : null;
                  const epsYoy = earningsPeriod === 'annual' && e.epsActual != null && prevEps != null && prevEps !== 0
                    ? ((e.epsActual - prevEps) / Math.abs(prevEps)) * 100
                    : null;
                  const changeVal = earningsPeriod === 'annual' ? epsYoy : surprise;
                  const changeColor = changeVal == null ? '#94a3b8' : changeVal >= 0 ? '#22c55e' : '#ef4444';
                  const fmtRevenue = (v: number | null) => {
                    if (v == null) return '—';
                    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
                    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
                    return `$${v.toFixed(0)}`;
                  };
                  return (
                    <View key={e.date} style={[styles.earningsRow, isFuture && styles.earningsRowFuture]}>
                      <View style={{ flex: 1.4 }}>
                        <Text style={styles.earningsDateTxt}>
                          {earningsPeriod === 'annual'
                            ? new Date(e.date + 'T12:00:00').getFullYear().toString()
                            : new Date((e.reportDate ?? e.date) + 'T12:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </Text>
                        {isFuture && <Text style={styles.earningsBadge}>Upcoming</Text>}
                        {earningsPeriod === 'quarter' && e.hour != null && (
                          <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                            {e.hour === 'bmo' ? 'Pre-mkt' : e.hour === 'amc' ? 'After-cls' : 'Intraday'}
                          </Text>
                        )}
                      </View>
                      <Text style={[styles.earningsCell, earningsPeriod === 'quarter' && isFuture && e.revenueActual == null ? { color: '#94a3b8' } : {}]}>
                        {fmtRevenue(
                          earningsPeriod === 'annual'
                            ? e.revenueActual
                            : (e.revenueActual ?? (isFuture ? e.revenueEstimated : null))
                        )}
                      </Text>
                      <Text style={[styles.earningsCell, e.epsActual == null && isFuture ? { color: '#94a3b8' } : {}]}>
                        {e.epsActual != null
                          ? e.epsActual.toFixed(2)
                          : (isFuture && e.epsEstimated != null ? e.epsEstimated.toFixed(2) : '—')}
                      </Text>
                      <View style={[styles.earningsCell, { alignItems: 'center' }]}>
                        {changeVal == null
                          ? <Text style={{ color: '#94a3b8' }}>—</Text>
                          : earningsPeriod === 'annual'
                            ? <Text style={{ color: changeColor, fontWeight: '600' }}>{`${changeVal >= 0 ? '+' : ''}${changeVal.toFixed(1)}%`}</Text>
                            : <TouchableOpacity onPress={() => setEarningsCard({ event: e, idx })} activeOpacity={0.75}>
                                <View style={[styles.marketBadge, {
                                  backgroundColor: changeVal >= 0 ? '#14532d' : '#431407',
                                  borderWidth: 1,
                                  borderColor: changeVal >= 0 ? '#86efac66' : '#fb923c66',
                                  flexDirection: 'row', alignItems: 'center', gap: 3,
                                }]}>
                                  <Ionicons name={changeVal >= 0 ? 'trending-up' : 'trending-down'} size={10} color={changeVal >= 0 ? '#86efac' : '#fb923c'} />
                                  <Text style={[styles.marketBadgeTxt, { color: changeVal >= 0 ? '#86efac' : '#fb923c' }]}>
                                    {changeVal >= 0 ? 'BEAT' : 'MISS'}
                                  </Text>
                                </View>
                              </TouchableOpacity>
                        }
                      </View>
                    </View>
                  );
                })}
              </View>
            )
        }

        {/* ── What Changed in 90 Days ──────────────────────── */}
        {!isEtf && (
          <>
            <Text style={styles.fundSection}>What Changed in the Last 90 Days?</Text>
            <View style={[styles.fundCard, { padding: 0, overflow: 'hidden' }]}>
              {whatChangedLoading && !whatChanged ? (
                <View style={{ padding: 20, alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color="#6366f1" />
                  <Text style={{ color: '#475569', fontSize: 12 }}>Analysing last 90 days…</Text>
                </View>
              ) : whatChanged ? (() => {
                const verdictColor = whatChanged.thesisVerdict === 'strengthened' ? '#22c55e'
                  : whatChanged.thesisVerdict === 'weakened' ? '#ef4444' : '#f59e0b';
                const verdictIcon = whatChanged.thesisVerdict === 'strengthened' ? '▲'
                  : whatChanged.thesisVerdict === 'weakened' ? '▼' : '→';

                const catIcon: Record<string, string> = {
                  earnings: '📊', valuation: '💰', growth: '📈', sentiment: '💬',
                  insiders: '👤', price: '📉', risk: '⚠️',
                };

                return (
                  <>
                    {/* Thesis verdict banner */}
                    <Pressable
                      onPress={() => setWhatChangedExpanded((v) => !v)}
                      style={{ backgroundColor: verdictColor + '18', borderBottomWidth: 1, borderBottomColor: verdictColor + '40', padding: 14 }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <Text style={{ color: verdictColor, fontSize: 16, fontWeight: '800', flex: 1 }}>{verdictIcon} Thesis {whatChanged.thesisVerdict.charAt(0).toUpperCase() + whatChanged.thesisVerdict.slice(1)}</Text>
                        <Ionicons name={whatChangedExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={verdictColor} />
                      </View>
                      <Text style={{ color: '#94a3b8', fontSize: 12, lineHeight: 18 }}>{whatChanged.thesisReason}</Text>
                    </Pressable>

                    {whatChangedExpanded && (
                      <>
                        {/* TL;DR */}
                        <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
                          <Text style={{ color: '#64748b', fontSize: 10, fontWeight: '700', marginBottom: 6, letterSpacing: 0.5 }}>TL;DR</Text>
                          <Text style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 20 }}>{whatChanged.tldr}</Text>
                        </View>

                        {/* Tab bar */}
                        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
                          {(['summary', 'positives', 'negatives', 'changes'] as const).map(t => (
                            <Pressable
                              key={t}
                              onPress={() => setWhatChangedTab(t)}
                              style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: whatChangedTab === t ? '#6366f1' : 'transparent' }}
                            >
                              <Text style={{ color: whatChangedTab === t ? '#6366f1' : '#475569', fontSize: 11, fontWeight: '600' }}>
                                {t === 'summary' ? 'Signals' : t === 'positives' ? '▲ Pros' : t === 'negatives' ? '▼ Cons' : '⟳ Changes'}
                              </Text>
                            </Pressable>
                          ))}
                        </View>

                        {/* Tab content */}
                        <View style={{ padding: 14, gap: 8 }}>
                          {whatChangedTab === 'summary' && whatChanged.signals.map((sig, i) => (
                            <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                              <View style={{
                                width: 6, height: 6, borderRadius: 3, marginTop: 5,
                                backgroundColor: sig.direction === 'positive' ? '#22c55e' : sig.direction === 'negative' ? '#ef4444' : '#f59e0b',
                              }} />
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '600' }}>
                                  {catIcon[sig.category] ?? '•'} {sig.label}
                                </Text>
                                <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2, lineHeight: 16 }}>{sig.detail}</Text>
                              </View>
                            </View>
                          ))}

                          {whatChangedTab === 'positives' && (
                            whatChanged.positives.length > 0
                              ? whatChanged.positives.map((p, i) => (
                                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                                  <Text style={{ color: '#22c55e', fontSize: 14, marginTop: 1 }}>+</Text>
                                  <Text style={{ flex: 1, color: '#cbd5e1', fontSize: 13, lineHeight: 19 }}>{p}</Text>
                                </View>
                              ))
                              : <Text style={{ color: '#475569', fontSize: 13 }}>No notable positives identified.</Text>
                          )}

                          {whatChangedTab === 'negatives' && (
                            whatChanged.negatives.length > 0
                              ? whatChanged.negatives.map((n, i) => (
                                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                                  <Text style={{ color: '#ef4444', fontSize: 14, marginTop: 1 }}>−</Text>
                                  <Text style={{ flex: 1, color: '#cbd5e1', fontSize: 13, lineHeight: 19 }}>{n}</Text>
                                </View>
                              ))
                              : <Text style={{ color: '#475569', fontSize: 13 }}>No notable negatives identified.</Text>
                          )}

                          {whatChangedTab === 'changes' && (
                            <View style={{ gap: 14 }}>
                              {[
                                { title: 'Changed Assumptions', items: whatChanged.changedAssumptions, color: '#6366f1' },
                                { title: 'Changed Narrative', items: whatChanged.changedNarrative, color: '#8b5cf6' },
                                { title: 'Changed Valuation', items: whatChanged.changedValuation, color: '#f59e0b' },
                                { title: 'Changed Risks', items: whatChanged.changedRisks, color: '#ef4444' },
                              ].map(({ title, items, color }) => items.length > 0 && (
                                <View key={title}>
                                  <Text style={{ color, fontSize: 11, fontWeight: '700', marginBottom: 6, letterSpacing: 0.4 }}>{title.toUpperCase()}</Text>
                                  {items.map((item, i) => (
                                    <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                                      <Text style={{ color, fontSize: 12 }}>⟳</Text>
                                      <Text style={{ flex: 1, color: '#cbd5e1', fontSize: 12, lineHeight: 18 }}>{item}</Text>
                                    </View>
                                  ))}
                                </View>
                              ))}
                            </View>
                          )}
                        </View>

                        {/* Footer timestamp */}
                        <View style={{ borderTopWidth: 1, borderTopColor: '#1e293b', padding: 8 }}>
                          <Text style={{ color: '#334155', fontSize: 9 }}>
                            Generated {new Date(whatChanged.generatedAt).toLocaleString()} · Powered by Groq llama-3.3-70b
                          </Text>
                        </View>
                      </>
                    )}
                  </>
                );
              })() : (
                <View style={{ padding: 16, alignItems: 'center' }}>
                  <Text style={{ color: '#475569', fontSize: 13 }}>
                    {groqKey ? 'Loading analysis…' : 'Add a Groq API key in Settings to enable this feature.'}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* ── AI Analysis ─────────────────────────────────── */}
        <Text style={styles.fundSection}>AI Analysis</Text>
        <View style={[styles.fundCard, { padding: 14 }]}>
          {aiAnalysis ? (
            <>
              {avTechnicals && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {avTechnicals.rsi != null && (
                    <View style={{ backgroundColor: avTechnicals.rsi >= 70 ? '#7f1d1d' : avTechnicals.rsi <= 30 ? '#14532d' : '#1e3a5f', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#e2e8f0', fontSize: 11 }}>RSI {avTechnicals.rsi.toFixed(1)}{avTechnicals.rsi >= 70 ? ' 🔴' : avTechnicals.rsi <= 30 ? ' 🟢' : ''}</Text>
                    </View>
                  )}
                  {avTechnicals.macdHist != null && (
                    <View style={{ backgroundColor: avTechnicals.macdHist > 0 ? '#14532d' : '#7f1d1d', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#e2e8f0', fontSize: 11 }}>MACD {avTechnicals.macdHist > 0 ? '▲' : '▼'} {avTechnicals.macdHist.toFixed(3)}</Text>
                    </View>
                  )}
                  {avTechnicals.sma50 != null && (
                    <View style={{ backgroundColor: (quote?.c ?? nativePrice) > avTechnicals.sma50 ? '#14532d' : '#7f1d1d', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#e2e8f0', fontSize: 11 }}>SMA50 {(quote?.c ?? nativePrice) > avTechnicals.sma50 ? '▲' : '▼'}</Text>
                    </View>
                  )}
                  {avTechnicals.news.length > 0 && (
                    <View style={{ backgroundColor: avTechnicals.news[0].score > 0.15 ? '#14532d' : avTechnicals.news[0].score < -0.15 ? '#7f1d1d' : '#334155', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#e2e8f0', fontSize: 11 }}>{avTechnicals.news[0].sentiment}</Text>
                    </View>
                  )}
                </View>
              )}
              <MarkdownText text={aiAnalysis} style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 22 }} />
              <TouchableOpacity
                style={{ marginTop: 12, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                onPress={async () => {
                  setAiAnalysis(null);
                  setAiError(null);
                  setAiLoading(true);
                  try {
                    const tech = await fetchAVTechnicals(symbol).catch(() => null);
                    setAvTechnicals(tech);
                    const result = await analyzeWithAI(groqKey, symbol, name, f, quote?.c ?? nativePrice, nativeCurrencySymbol, tech ?? undefined);
                    setAiAnalysis(result);
                  } catch (e: any) {
                    setAiError(e?.message ?? 'Error fetching analysis.');
                  } finally {
                    setAiLoading(false);
                  }
                }}
              >
                <Ionicons name="refresh-outline" size={14} color="#6366f1" />
                <Text style={{ color: '#6366f1', fontSize: 13 }}>Refresh</Text>
              </TouchableOpacity>
            </>
          ) : aiLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 16, gap: 10 }}>
              <ActivityIndicator color="#6366f1" />
              <Text style={{ color: '#64748b', fontSize: 13 }}>Fetching technical data and analyzing with AI…</Text>
            </View>
          ) : aiError ? (
            <>
              <Text style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{aiError}</Text>
              <TouchableOpacity
                style={{ backgroundColor: '#6366f1', paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
                onPress={async () => {
                  setAiError(null);
                  setAiLoading(true);
                  try {
                    const tech = await fetchAVTechnicals(symbol).catch(() => null);
                    setAvTechnicals(tech);
                    const result = await analyzeWithAI(groqKey, symbol, name, f, quote?.c ?? nativePrice, nativeCurrencySymbol, tech ?? undefined);
                    setAiAnalysis(result);
                  } catch (e: any) {
                    setAiError(e?.message ?? 'Error fetching analysis.');
                  } finally {
                    setAiLoading(false);
                  }
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 }}
              onPress={async () => {
                setAiLoading(true);
                setAiError(null);
                try {
                  const tech = await fetchAVTechnicals(symbol).catch(() => null);
                  setAvTechnicals(tech);
                  const result = await analyzeWithAI(groqKey, symbol, name, f, quote?.c ?? nativePrice, nativeCurrencySymbol, tech ?? undefined);
                  setAiAnalysis(result);
                } catch (e: any) {
                  setAiError(e?.message ?? 'Error fetching analysis.');
                } finally {
                  setAiLoading(false);
                }
              }}
            >
              <Ionicons name="sparkles-outline" size={18} color="#6366f1" />
              <Text style={{ color: '#6366f1', fontSize: 15, fontWeight: '600' }}>Analyze with AI</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 30 }} />
      </>
    );
  };

  const myTxs = transactions.filter((t) => t.symbol === symbol);

  // Calculate total dividends received, weighted by shares held at each ex-date
  const totalDividendsReceived = (() => {
    if (dividends.length === 0 || myTxs.length === 0) return null;
    const sortedTxs = [...myTxs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let total = 0;
    for (const div of dividends) {
      if (!div.date) continue;
      let sharesAtDate = 0;
      for (const tx of sortedTxs) {
        if (new Date(tx.date).getTime() / 1000 <= div.date) {
          sharesAtDate += tx.type === 'buy' ? tx.shares : -tx.shares;
        }
      }
      if (sharesAtDate > 0) total += applyDividendTax(div.amount * sharesAtDate);
    }
    return total > 0 ? total * fxRate : null;
  })();

  const PortfolioTab = () => (
    <>
      {shares > 0 && (
        <>
          <Text style={styles.fundSection}>Current Position</Text>
          <View style={styles.fundCard}>
            <View style={styles.divGridRow}>
              <View style={styles.divGridCell}>
                <Text style={styles.divGridLabel}>Shares</Text>
                <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}><Text style={styles.divGridValue}>{shares % 1 === 0 ? shares.toFixed(0) : shares.toFixed(4).replace(/\.?0+$/, '')}</Text></BlurValue>
              </View>
              <View style={styles.divGridCell}>
                <Text style={styles.divGridLabel}>Avg. Price</Text>
                <Text style={styles.divGridValue}>{avgPrice.toFixed(2)} {nativeCurrencySymbol}</Text>
                {!sameAsCurrency && <Text style={[styles.divGridValue, { fontSize: 11, color: '#94a3b8', marginTop: 1 }]}>{(avgPrice * fxRate).toFixed(2)} {currencySymbol}</Text>}
              </View>
            </View>
            <View style={styles.divDivider} />
            <View style={styles.divGridRow}>
              <View style={styles.divGridCell}>
                <Text style={styles.divGridLabel}>Total Cost</Text>
                <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}><Text style={styles.divGridValue}>{(avgPrice * shares).toFixed(2)} {nativeCurrencySymbol}</Text></BlurValue>
                {!sameAsCurrency && !hideValues && <Text style={[styles.divGridValue, { fontSize: 11, color: '#94a3b8', marginTop: 1 }]}>{(avgPrice * fxRate * shares).toFixed(2)} {currencySymbol}</Text>}
              </View>
              <View style={styles.divGridCell}>
                <Text style={styles.divGridLabel}>Current Value</Text>
                <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}><Text style={styles.divGridValue}>{(nativePrice * shares).toFixed(2)} {nativeCurrencySymbol}</Text></BlurValue>
                {!sameAsCurrency && !hideValues && <Text style={[styles.divGridValue, { fontSize: 11, color: '#94a3b8', marginTop: 1 }]}>{(currentPrice * shares).toFixed(2)} {currencySymbol}</Text>}
              </View>
            </View>
            <View style={styles.divDivider} />
            {totalDividendsReceived !== null && renderFundRow('Dividends Received', hideValues ? '••••' : `${totalDividendsReceived.toFixed(2)} ${currencySymbol}`)}
            <View style={[styles.fundRow, { borderBottomWidth: 0 }]}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 4 }}
                onPress={() => setInfoModal(FUND_GLOSSARY['Price Gain'])}
              >
                <Text style={styles.fundLabel}>Price Gain</Text>
                <Text style={{ color: '#475569', fontSize: 13, lineHeight: 18 }}>ⓘ</Text>
              </TouchableOpacity>
              <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
                <BlurValue hidden={hideValues} tint={isPositive ? 'green' : 'red'}>
                  <Text style={[styles.fundValue, { color: isPositive ? '#22c55e' : '#ef4444', maxWidth: '100%' }]}>
                    {isPositive ? '+' : ''}{gainAbs.toFixed(2)} {currencySymbol}
                  </Text>
                </BlurValue>
                <Text style={[styles.fundValue, { color: isPositive ? '#22c55e' : '#ef4444', maxWidth: '100%' }]}>
                  {" "}({isPositive ? '+' : ''}{gainPct.toFixed(2)}%)
                </Text>
              </View>
            </View>
            {totalDividendsReceived !== null && (() => {
              const totalReturn = gainAbs + totalDividendsReceived;
              const cost = avgPrice * fxRate * shares;
              const totalReturnPct = cost > 0 ? (totalReturn / cost) * 100 : 0;
              const pos = totalReturn >= 0;
              return (
                <View style={[styles.fundRow, { borderBottomWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#334155', marginTop: 4, paddingTop: 10 }]}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 4 }}
                    onPress={() => setInfoModal(FUND_GLOSSARY['Total Return'])}
                  >
                    <Text style={[styles.fundLabel, { fontWeight: '700', color: '#f8fafc' }]}>Total Return</Text>
                    <Text style={{ color: '#475569', fontSize: 13, lineHeight: 18 }}>ⓘ</Text>
                  </TouchableOpacity>
                  <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
                    <BlurValue hidden={hideValues} tint={pos ? 'green' : 'red'}>
                      <Text style={[styles.fundValue, { color: pos ? '#22c55e' : '#ef4444', fontWeight: '700', maxWidth: '100%' }]}>
                        {pos ? '+' : ''}{totalReturn.toFixed(2)} {currencySymbol}
                      </Text>
                    </BlurValue>
                    <Text style={[styles.fundValue, { color: pos ? '#22c55e' : '#ef4444', fontWeight: '700', maxWidth: '100%' }]}>
                      {" "}({pos ? '+' : ''}{totalReturnPct.toFixed(2)}%)
                    </Text>
                  </View>
                </View>
              );
            })()}
          </View>
        </>
      )}
      <Text style={styles.fundSection}>Transaction History</Text>
      {myTxs.length > 0 && (
        <View style={styles.fundCard}>
          {[...myTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((tx) => {
            const lot = tx.type === 'buy' ? fifoLotMap.get(tx.id) : undefined;
            const fullyConsumed = lot ? lot.remainingShares <= 0 : false;
            const partiallyConsumed = lot ? lot.soldShares > 0 && lot.remainingShares > 0 : false;
            const txGainAbs = tx.type === 'buy' && nativePrice > 0
              ? (nativePrice - tx.price) * tx.shares * fxRate
              : null;
            const txGainPct = tx.type === 'buy' && tx.price > 0
              ? ((nativePrice - tx.price) / tx.price) * 100
              : null;
            const txPositive = txGainAbs !== null && txGainAbs >= 0;
            const dimmed = fullyConsumed;
            if (isDesktop) {
              return (
                <View key={tx.id} style={[styles.txRow, dimmed && { opacity: 0.45 }, { flexDirection: 'row', alignItems: 'center' }]}>
                  <View style={[styles.txBadge, { backgroundColor: tx.type === 'buy' ? '#16a34a22' : '#dc262622' }]}>
                    <Text style={[styles.txBadgeTxt, { color: tx.type === 'buy' ? '#22c55e' : '#ef4444' }]}>
                      {tx.type === 'buy' ? 'Buy' : 'Sell'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}>
                      <Text style={[styles.txShares, dimmed && { color: '#64748b' }]}>
                        {tx.shares % 1 === 0 ? tx.shares.toFixed(0) : tx.shares.toFixed(4).replace(/\.?0+$/, '')} shares
                      </Text>
                    </BlurValue>
                    <Text style={styles.txDate}>{new Date(tx.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                    {fullyConsumed && <Text style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Position sold (FIFO)</Text>}
                    {partiallyConsumed && lot && (
                      <Text style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                        {lot.soldShares % 1 === 0 ? lot.soldShares.toFixed(0) : lot.soldShares.toFixed(2)} sold · {lot.remainingShares % 1 === 0 ? lot.remainingShares.toFixed(0) : lot.remainingShares.toFixed(2)} remaining
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                    <Text style={[styles.txPrice, dimmed && { color: '#64748b' }]}>{tx.price.toFixed(2)} {nativeCurrencySymbol}</Text>
                    {txGainAbs !== null && txGainPct !== null && !fullyConsumed && (
                      <Text style={{ fontSize: 12, fontWeight: '600', color: txPositive ? '#22c55e' : '#ef4444', marginTop: 2 }}>
                        {!hideValues && `${txPositive ? '+' : ''}${txGainAbs.toFixed(2)} ${currencySymbol} `}({txPositive ? '+' : ''}{txGainPct.toFixed(2)}%)
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={{ padding: 6, borderRadius: 6 }}
                    onPress={(e) => {
                      const { clientX, clientY } = e.nativeEvent as any;
                      setTxKebabPos({ top: (clientY ?? 0) + 8, right: window.innerWidth - (clientX ?? 0) });
                      setTxKebabId(tx.id);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color="#64748b" />
                  </TouchableOpacity>
                </View>
              );
            }
            return (
              <ReanimatedSwipeable
                key={tx.id}
                overshootRight={false}
                friction={2}
                rightThreshold={40}
                renderRightActions={() => (
                  <View style={styles.txActionsRow}>
                    <RectButton style={styles.txActionEdit} onPress={() => isCombinedPortfolio ? Alert.alert('Read-only', 'Select a specific portfolio before editing transactions.') : openEditTx(tx)}>
                      <Ionicons name="pencil-outline" size={18} color="#fff" />
                      <Text style={styles.txActionTxt}>Edit</Text>
                    </RectButton>
                    <RectButton style={styles.txActionDelete} onPress={() => isCombinedPortfolio ? Alert.alert('Read-only', 'Select a specific portfolio before deleting transactions.') : confirmDeleteTx(tx.id)}>
                      <Ionicons name="trash-outline" size={18} color="#fff" />
                      <Text style={styles.txActionTxt}>Delete</Text>
                    </RectButton>
                  </View>
                )}
              >
                <View style={[styles.txRow, dimmed && { opacity: 0.45 }]}>
                  <View style={[styles.txBadge, { backgroundColor: tx.type === 'buy' ? '#16a34a22' : '#dc262622' }]}>
                    <Text style={[styles.txBadgeTxt, { color: tx.type === 'buy' ? '#22c55e' : '#ef4444' }]}>
                      {tx.type === 'buy' ? 'Buy' : 'Sell'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}>
                      <Text style={[styles.txShares, dimmed && { color: '#64748b' }]}>
                        {tx.shares % 1 === 0 ? tx.shares.toFixed(0) : tx.shares.toFixed(4).replace(/\.?0+$/, '')} shares
                      </Text>
                    </BlurValue>
                    <Text style={styles.txDate}>{new Date(tx.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                    {fullyConsumed && (
                      <Text style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Position sold (FIFO)</Text>
                    )}
                    {partiallyConsumed && lot && (
                      <Text style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                        {lot.soldShares % 1 === 0 ? lot.soldShares.toFixed(0) : lot.soldShares.toFixed(2)} sold · {lot.remainingShares % 1 === 0 ? lot.remainingShares.toFixed(0) : lot.remainingShares.toFixed(2)} remaining
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.txPrice, dimmed && { color: '#64748b' }]}>{tx.price.toFixed(2)} {nativeCurrencySymbol}</Text>
                    {txGainAbs !== null && txGainPct !== null && !fullyConsumed && (
                      <Text style={{ fontSize: 12, fontWeight: '600', color: txPositive ? '#22c55e' : '#ef4444', marginTop: 2 }}>
                        {!hideValues && `${txPositive ? '+' : ''}${txGainAbs.toFixed(2)} ${currencySymbol} `}({txPositive ? '+' : ''}{txGainPct.toFixed(2)}%)
                      </Text>
                    )}
                  </View>
                </View>
              </ReanimatedSwipeable>
            );
          })}
        </View>
      )}
      {myTxs.length === 0 && (
        <Text style={{ color: '#64748b', textAlign: 'center', paddingVertical: 16, fontSize: 14 }}>
          No transactions recorded.
        </Text>
      )}
      <TouchableOpacity
        style={{ marginHorizontal: 16, marginTop: 10, marginBottom: 4, paddingVertical: 13, backgroundColor: '#6366f1', borderRadius: 10, alignItems: 'center' }}
        onPress={() => {
          if (isCombinedPortfolio) {
            Alert.alert('Read-only', 'Select a specific portfolio before adding transactions.');
            return;
          }
          setTxModalVisible(true);
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>+ Add Transaction</Text>
      </TouchableOpacity>
      <View style={{ height: 30 }} />
    </>
  );

  const DividendosTab = () => {
    if (divLoading) return <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />;

    const f = fundamentals;
    const sortedDivs = [...dividends].sort((a, b) => b.date - a.date);
    const hasDivs = sortedDivs.length > 0;

    // ---- Cálculos a partir dos dividendos históricos ----
    const now = Date.now() / 1000;
    const currentYear = new Date().getFullYear();
    const annualTotals = (() => {
      const byYear: Record<number, number> = {};
      for (const d of sortedDivs) {
        const year = new Date(d.date * 1000).getFullYear();
        if (year === currentYear) continue;
        byYear[year] = (byYear[year] ?? 0) + applyDividendTax(d.amount);
      }
      return byYear;
    })();
    const completeYears = Object.keys(annualTotals).map(Number).sort((a, b) => b - a);
    const latestCompleteYear = completeYears[0] ?? null;

    const annualSum = (yearsAgo: number) => {
      if (yearsAgo === 0) {
        const from = now - 365 * 86400;
        return sortedDivs
          .filter(d => d.date >= from && d.date <= now)
          .reduce((sum, d) => sum + applyDividendTax(d.amount), 0);
      }
      if (latestCompleteYear == null) return 0;
      return annualTotals[latestCompleteYear - yearsAgo] ?? 0;
    };
    const ttmPayout = annualSum(0);

    const cagrFromAnnualTotals = (years: number) => {
      if (latestCompleteYear == null) return null;
      const past = annualTotals[latestCompleteYear - years] ?? 0;
      const latest = annualTotals[latestCompleteYear] ?? 0;
      return past > 0 && latest > 0 ? (Math.pow(latest / past, 1 / years) - 1) * 100 : null;
    };

    const growth1Y  = cagrFromAnnualTotals(1);
    const growth3Y  = cagrFromAnnualTotals(3);
    const growth5Y  = cagrFromAnnualTotals(5);
    const growth10Y = cagrFromAnnualTotals(10);

    const nextPayment = sortedDivs[0]?.amount != null
      ? applyDividendTax(sortedDivs[0].amount)
      : f?.dividendPerShare != null
        ? applyDividendTax(f.dividendPerShare)
        : null;

    const calcFrequency = (): string | null => {
      if (sortedDivs.length < 2) return null;
      const diffDays = (sortedDivs[0].date - sortedDivs[1].date) / 86400;
      if (diffDays < 20) return 'Weekly';
      if (diffDays < 45) return 'Monthly';
      if (diffDays < 100) return 'Quarterly';
      if (diffDays < 200) return 'Semi-annual';
      return 'Annual';
    };
    const dividendFrequency = f?.dividendFrequency ?? calcFrequency();

    const growthLabel = (g: number | null) => {
      if (g == null) return '—';
      if (g >= 15) return 'Strong growth';
      if (g >= 5) return 'Growth';
      if (g >= 0) return 'Stable';
      return 'Declining';
    };

    const revenueHistory = f?.revenueHistory ?? [];
    const maxRev = revenueHistory.length > 0 ? Math.max(...revenueHistory.map(r => r.revenue)) : 1;
    const fmtRev = (v: number) => {
      if (v >= 1e12) return `${(v / 1e12).toFixed(0)}T`;
      if (v >= 1e9) return `${(v / 1e9).toFixed(0)}B`;
      if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
      return `${v}`;
    };

    const hasDivInfo = hasDivs || (f && (f.dividendYield || f.dividendPerShare));

    // Count consecutive years of dividend growth
    const growthYears = (() => {
      if (sortedDivs.length < 2) return null;
      const currentYear = new Date().getFullYear();
      const byYear: Record<number, { sum: number; count: number }> = {};
      for (const d of sortedDivs) {
        const y = new Date(d.date * 1000).getFullYear();
        if (y === currentYear) continue; // skip incomplete current year
        byYear[y] = { sum: (byYear[y]?.sum ?? 0) + applyDividendTax(d.amount), count: (byYear[y]?.count ?? 0) + 1 };
      }
      const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
      if (years.length < 2) return null;
      // Compare average per-payment: avoids 12-vs-13-payment distortion for monthly payers
      // Allow up to 0.5% decline as a rounding/timing tolerance
      let count = 0;
      for (let i = 0; i < years.length - 1; i++) {
        const cur  = byYear[years[i]].sum  / byYear[years[i]].count;
        const prev = byYear[years[i + 1]].sum / byYear[years[i + 1]].count;
        if (cur >= prev * 0.995) count++;
        else break;
      }
      return count;
    })();

    // Consecutive years with AT LEAST ONE dividend paid (streak may not grow)
    const dividendStreak = (() => {
      if (sortedDivs.length === 0) return null;
      const currentYear = new Date().getFullYear();
      const byYear: Record<number, number> = {};
      for (const d of sortedDivs) {
        const y = new Date(d.date * 1000).getFullYear();
        if (y === currentYear) continue;
        byYear[y] = (byYear[y] ?? 0) + applyDividendTax(d.amount);
      }
      const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
      if (years.length === 0) return null;
      let count = 0;
      for (let i = 0; i < years.length - 1; i++) {
        if (byYear[years[i]] > 0 && years[i] - years[i + 1] === 1) count++;
        else break;
      }
      return count + 1; // include first year
    })();

    // Annual sums for area chart (oldest → newest), excluding current incomplete year
    const chartByYear: Record<number, number> = {};
    const currentYearForChart = new Date().getFullYear();
    for (const d of dividends) {
      const y = new Date(d.date * 1000).getFullYear();
      if (y === currentYearForChart) continue;
      chartByYear[y] = (chartByYear[y] ?? 0) + applyDividendTax(d.amount);
    }
    const chartYears = Object.keys(chartByYear).map(Number).sort((a, b) => a - b);
    const chartData = chartYears.map(y => ({ year: y, amount: chartByYear[y] }));

    if (!hasDivInfo) return <Text style={styles.emptyText}>No dividends recorded</Text>;

    const currSym = currency === 'EUR' ? '€' : '$';

    return (
      <>
        {/* === Dividend History Chart === */}
        {chartData.length >= 2 && (() => {
          const CHART_W = isDesktop ? Math.floor(Math.min(windowWidth, 1280) * 0.6) - 28 : SCREEN_WIDTH - 56;
          const CHART_H = 160;
          const PAD_L = 8;
          const PAD_R = 8;
          const PAD_T = 12;
          const PAD_B = 28; // room for x labels
          const DW = CHART_W - PAD_L - PAD_R;
          const DH = CHART_H - PAD_T - PAD_B;
          const n = chartData.length;
          const maxAmt = Math.max(...chartData.map(d => d.amount));
          const yScale = (v: number) => PAD_T + DH - (v / maxAmt) * DH;
          const xScale = (i: number) => PAD_L + (i / (n - 1)) * DW;

          // Build area path: line along top then down to baseline
          let linePath = '';
          let areaPath = '';
          chartData.forEach((d, i) => {
            const x = xScale(i).toFixed(1);
            const y = yScale(d.amount).toFixed(1);
            linePath += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
          });
          const firstX = xScale(0).toFixed(1);
          const lastX = xScale(n - 1).toFixed(1);
          const base = (PAD_T + DH).toFixed(1);
          areaPath = `${linePath} L${lastX},${base} L${firstX},${base} Z`;

          // X-axis: show one label every ~5 years
          const step = Math.max(1, Math.round(n / 8));
          const xLabels = chartData
            .map((d, i) => ({ i, year: d.year }))
            .filter((_, i) => i % step === 0 || i === n - 1);

          return (
            <View style={{ backgroundColor: '#1e293b', borderRadius: 14, padding: 12, marginBottom: 14 }}>
              <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>
                Dividend per Share — History
              </Text>
              <Svg width={CHART_W} height={CHART_H}>
                {/* Area fill */}
                <SvgPath d={areaPath} fill="#14b8a680" />
                {/* Line */}
                <SvgPath d={linePath} stroke="#14b8a6" strokeWidth={2} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" />
                {/* X-axis labels */}
                {xLabels.map(({ i, year }) => (
                  <SvgText
                    key={year}
                    x={xScale(i)}
                    y={CHART_H - 6}
                    fontSize={8.5}
                    fill="#475569"
                    textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                  >
                    {year}
                  </SvgText>
                ))}
                {/* Y max label */}
                <SvgText x={PAD_L} y={PAD_T - 2} fontSize={8} fill="#475569" textAnchor="start">
                  ${maxAmt.toFixed(2)}
                </SvgText>
              </Svg>

              {/* Streak badges */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                {dividendStreak != null && (
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: '#0f172a', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#14b8a622',
                      alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 14 }}>🏆</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#14b8a6', fontSize: 16, fontWeight: '800', lineHeight: 18 }}>
                        {dividendStreak}y
                      </Text>
                      <Text style={{ color: '#475569', fontSize: 10, fontWeight: '500' }}>Dividend Streak</Text>
                    </View>
                    <Pressable onPress={() => setInfoModal({ title: 'Dividend Streak', desc: 'Número de anos consecutivos em que a empresa pagou pelo menos um dividendo.\n\nNão requer crescimento — basta pagar.\n\nExemplo: empresa que paga dividendos desde 1991 sem interrupção tem um streak de ~33 anos.' })}
                      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
                      <Text style={{ color: '#6366f1', fontSize: 12 }}>ⓘ</Text>
                    </Pressable>
                  </View>
                )}
                {growthYears != null && growthYears > 0 && (
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: '#0f172a', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#22c55e22',
                      alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 14 }}>📈</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#22c55e', fontSize: 16, fontWeight: '800', lineHeight: 18 }}>
                        {growthYears}y
                      </Text>
                      <Text style={{ color: '#475569', fontSize: 10, fontWeight: '500' }}>Div. Growth Streak</Text>
                    </View>
                    <Pressable onPress={() => setInfoModal({ title: 'Dividend Growth Streak', desc: 'Número de anos consecutivos em que a empresa aumentou o dividendo anual.\n\nCritério mais exigente que o Dividend Streak.\n\nEmpresas como a Coca-Cola (62 anos), Johnson & Johnson (62 anos) ou Procter & Gamble (68 anos) são chamadas "Dividend Kings" (>50 anos de crescimento consecutivo).' })}
                      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
                      <Text style={{ color: '#6366f1', fontSize: 12 }}>ⓘ</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })()}

        {/* === General === */}
        <Text style={styles.fundSection}>General</Text>
        <View style={styles.fundCard}>
          {/* Row 1: Annual payout | Yield */}
          <View style={styles.divGridRow}>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Annual Dividend</Text>
              <Text style={styles.divGridValue}>{ttmPayout > 0 ? `${currSym}${ttmPayout.toFixed(2)}` : (f?.dividendPerShare ? `${currSym}${applyDividendTax(f.dividendPerShare).toFixed(2)}` : '—')}</Text>
            </View>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Dividend Yield</Text>
              <Text style={styles.divGridValue}>{f?.dividendYield != null ? `${((f.dividendYield * dividendNetMultiplier) * 100).toFixed(2)}%` : '—'}</Text>
            </View>
          </View>
          <View style={styles.divDivider} />
          {/* Row 2: Payout ratio | FCF Payout */}
          <View style={styles.divGridRow}>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Payout Ratio</Text>
              <Text style={styles.divGridValue}>{f?.payoutRatio != null ? `${(f.payoutRatio * 100).toFixed(2)}%` : '—'}</Text>
            </View>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>FCF Payout</Text>
              <Text style={styles.divGridValue}>{f?.fcfPayoutRatio != null ? `${(f.fcfPayoutRatio * 100).toFixed(1)}%` : '—'}</Text>
            </View>
          </View>
          <View style={styles.divDivider} />
          {/* Row 3: Ex-Div Date | Next payment */}
          <View style={styles.divGridRow}>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Ex-Dividend Date</Text>
              <Text style={styles.divGridValue}>{f?.exDividendDate ?? '—'}</Text>
            </View>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Next Payment</Text>
              <Text style={styles.divGridValue}>{nextPayment != null ? `${currSym}${nextPayment.toFixed(3)}` : '—'}</Text>
            </View>
          </View>
          <View style={styles.divDivider} />
          {/* Row 4: Payout Frequency | Growth Years */}
          <View style={styles.divGridRow}>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Payout Frequency</Text>
              <Text style={styles.divGridValue}>{dividendFrequency ?? '—'}</Text>
            </View>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Growth Years</Text>
              <Text style={styles.divGridValue}>{growthYears != null ? `${growthYears} yr${growthYears !== 1 ? 's' : ''}` : '—'}</Text>
            </View>
          </View>
          <View style={styles.divDivider} />
          {/* Row 5: Buyback Yield */}
          <View style={styles.divGridRow}>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Buyback Yield</Text>
              <Text style={styles.divGridValue}>{f?.buybackYield != null ? `${(f.buybackYield * 100).toFixed(2)}%` : '—'}</Text>
            </View>
            <View style={styles.divGridCell}>
              <Text style={styles.divGridLabel}>Shareholder Yield</Text>
              <Text style={styles.divGridValue}>{(f?.dividendYield != null || f?.buybackYield != null) ? `${((((f?.dividendYield ?? 0) * dividendNetMultiplier) + (f?.buybackYield ?? 0)) * 100).toFixed(2)}%` : '—'}</Text>
            </View>
          </View>
        </View>

        {/* === Growth === */}
        {[growth1Y, growth3Y, growth5Y, growth10Y].some(g => g != null) && (
          <>
            <Text style={styles.fundSection}>Growth</Text>
            <View style={styles.fundCard}>
              {([
                { label: '1 Year',  g: growth1Y },
                { label: '3 Year',  g: growth3Y },
                { label: '5 Year',  g: growth5Y },
                { label: '10 Year', g: growth10Y },
              ] as const).filter(row => row.g != null).map(({ label, g }) => (
                <View key={label} style={styles.divGrowthRow}>
                  <Text style={styles.divGrowthYear}>{label}</Text>
                  <View style={styles.divGrowthBadge}>
                    <Text style={styles.divGrowthBadgeTxt}>{growthLabel(g)}</Text>
                  </View>
                  <Text style={[styles.divGrowthPct, { color: (g ?? 0) >= 0 ? '#22c55e' : '#ef4444' }]}>
                    {(g ?? 0) >= 0 ? '↗' : '↘'}{Math.abs(g ?? 0).toFixed(2)}%
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* === Total Revenue === */}
        {revenueHistory.length > 1 && (
          <>
            <Text style={styles.fundSection}>Total Revenue</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 24, paddingHorizontal: 4 }}>
              <View style={{ width: 36, alignItems: 'flex-end', paddingRight: 4, justifyContent: 'space-between', height: 160 }}>
                {[maxRev, maxRev * 0.75, maxRev * 0.5, maxRev * 0.25, 0].map((v, i) => (
                  <Text key={i} style={{ color: '#64748b', fontSize: 9 }}>{fmtRev(v)}</Text>
                ))}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 160, gap: 8 }}>
                  {revenueHistory.map((r) => {
                    const barH = Math.max((r.revenue / maxRev) * 130, 4);
                    return (
                      <View key={r.year} style={{ alignItems: 'center', width: 40 }}>
                        <Text style={{ color: '#94a3b8', fontSize: 9, marginBottom: 2 }}>{fmtRev(r.revenue)}</Text>
                        <View style={{ width: 32, height: barH, backgroundColor: '#22c55e', borderRadius: 4 }} />
                        <Text style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>{r.year}</Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          </>
        )}

        {/* === Dividendos timeline === */}
        {hasDivs && (() => {
          const freqDays = dividendFrequency === 'Weekly' ? 7
            : dividendFrequency === 'Monthly' ? 30
            : dividendFrequency === 'Quarterly' ? 91
            : dividendFrequency === 'Semi-annual' ? 183
            : dividendFrequency === 'Annual' ? 365
            : null;
          const predicted = freqDays && sortedDivs.length > 0 ? (() => {
            const nextDate = sortedDivs[0].date + freqDays * 86400;
            return nextDate > now ? { date: nextDate, amount: applyDividendTax(sortedDivs[0].amount), past: false } : null;
          })() : null;
          const allEntries: { date: number; amount: number; past: boolean }[] = [
            ...(predicted ? [predicted] : []),
            ...sortedDivs.map(d => ({ date: d.date, amount: applyDividendTax(d.amount), past: true })),
          ];
          const visibleEntries = showAllDivs ? allEntries : allEntries.slice(0, 5);
          const maxAmt = Math.max(...visibleEntries.map(e => e.amount), 0.001);
          const DOT = 10;
          const LINE_COLOR = '#3b82f6';
          return (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 8, marginHorizontal: 4 }}>
                <Text style={[styles.fundSection, { marginTop: 0, marginBottom: 0, marginLeft: 0, flex: 1 }]}>Dividends</Text>
                {allEntries.length > 5 && (
                  <TouchableOpacity onPress={() => navigation.navigate('StockDividendHistory', {
                    symbol,
                    name,
                    currency: nativeCurrencySymbol === '€' ? 'EUR' : 'USD',
                    currentPrice: nativePrice,
                  })}>
                    <Text style={{ color: '#6366f1', fontSize: 13, fontWeight: '600' }}>Show All</Text>
                  </TouchableOpacity>
                )}
              </View>
              {visibleEntries.map((entry, i) => {
                const isFirst = i === 0;
                const isLast = i === visibleEntries.length - 1;
                const isFuture = !entry.past;
                const nextIsFuture = i + 1 < visibleEntries.length && !visibleEntries[i + 1].past;
                const barPct = entry.amount / maxAmt;
                const mon = new Date(entry.date * 1000).toLocaleString('en-US', { month: 'short' });
                const yr = String(new Date(entry.date * 1000).getFullYear()).slice(-2);
                const label = `${mon} ${yr}`;
                const topDashed = isFuture;
                const bottomDashed = isFuture || nextIsFuture;
                return (
                  <View key={entry.date} style={{ flexDirection: 'row', minHeight: 52 }}>
                    {/* Timeline column */}
                    <View style={{ width: 20, alignItems: 'center' }}>
                      {isFirst
                        ? <View style={{ flex: 1 }} />
                        : <View style={topDashed
                            ? { flex: 1, width: 2, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: LINE_COLOR }
                            : { flex: 1, width: 2, backgroundColor: LINE_COLOR }
                          } />
                      }
                      <View style={{
                        width: DOT, height: DOT, borderRadius: DOT / 2,
                        backgroundColor: isFuture ? 'transparent' : LINE_COLOR,
                        borderWidth: 2, borderColor: LINE_COLOR,
                      }} />
                      {isLast
                        ? <View style={{ flex: 1 }} />
                        : <View style={bottomDashed
                            ? { flex: 1, width: 2, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: LINE_COLOR }
                            : { flex: 1, width: 2, backgroundColor: LINE_COLOR }
                          } />
                      }
                    </View>
                    {/* Content */}
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingVertical: 8 }}>
                      <Text style={{ color: isFuture ? '#94a3b8' : '#e2e8f0', fontSize: 14, fontWeight: '700', width: 52 }}>
                        {label}
                      </Text>
                      <View style={{ flex: 1, height: 7, backgroundColor: '#0f172a', borderRadius: 4, marginHorizontal: 8 }}>
                        <View style={{
                          width: `${Math.max(barPct * 100, 4)}%`,
                          height: 7,
                          backgroundColor: isFuture ? '#475569' : LINE_COLOR,
                          borderRadius: 4,
                        }} />
                      </View>
                      <Text style={{ color: isFuture ? '#94a3b8' : '#e2e8f0', fontSize: 14, fontWeight: '700', width: 48, textAlign: 'right' }}>
                        ${(entry.amount * fxRate).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </>
          );
        })()}

        <View style={{ height: 30 }} />
      </>
    );
  };

  const FinancialsTab = () => {
    const ROW_H = 50;
    const LABEL_W = 138;
    const COL_W = 82;

    type FRow = { label: string; key: string; bold?: boolean; isMeta?: boolean; isEps?: boolean; isShares?: boolean };

    const incomeRows: FRow[] = [
      { label: 'Revenue', key: 'revenue', bold: true },
      { label: 'Cost of Revenue', key: 'costOfRevenue' },
      { label: 'Gross Profit', key: 'grossProfit', bold: true },
      { label: 'Gross Margin', key: '_grossMargin', isMeta: true },
      { label: 'R&D', key: 'rAndD' },
      { label: 'SG&A', key: 'sgAndA' },
      { label: 'Operating Income', key: 'operatingIncome', bold: true },
      { label: 'Op. Margin', key: '_opMargin', isMeta: true },
      { label: 'EBITDA', key: 'ebitda', bold: true },
      { label: 'EBITDA Margin', key: '_ebitdaMargin', isMeta: true },
      { label: 'Interest Expense', key: 'interestExpense' },
      { label: 'Pre-tax Income', key: 'pretaxIncome' },
      { label: 'Income Tax', key: 'incomeTax' },
      { label: 'Net Income', key: 'netIncome', bold: true },
      { label: 'Net Margin', key: '_netMargin', isMeta: true },
      { label: 'SBC', key: 'sbc' },
      { label: 'EPS (Diluted)', key: 'epsDiluted', isEps: true },
      { label: 'Shares (Diluted)', key: 'sharesDiluted', isShares: true },
    ];
    const balanceRows: FRow[] = [
      { label: 'Cash & Equiv.', key: 'cash', bold: true },
      { label: 'Cash + ST Invest.', key: 'cashAndShortTermInvestments', bold: true },
      { label: 'Current Assets', key: 'currentAssets' },
      { label: 'Total Assets', key: 'totalAssets', bold: true },
      { label: 'Current Liabilities', key: 'currentLiabilities' },
      { label: 'Short-term Debt', key: 'shortTermDebt' },
      { label: 'Long-term Debt', key: 'longTermDebt' },
      { label: 'Net Debt', key: 'netDebt' },
      { label: 'Total Liabilities', key: 'totalLiabilities', bold: true },
      { label: 'Equity', key: 'equity', bold: true },
      { label: 'Retained Earnings', key: 'retainedEarnings' },
      { label: 'Goodwill', key: 'goodwill' },
    ];
    const cashRows: FRow[] = [
      { label: 'Operating CF', key: 'operatingCF', bold: true },
      { label: 'Capital Expenditure', key: 'capex' },
      { label: 'Free Cash Flow', key: '_freeCF', bold: true },
      { label: 'FCF Margin', key: '_fcfMargin', isMeta: true },
      { label: 'D&A', key: 'dAndA' },
      { label: 'Buybacks', key: 'buybacks', bold: true },
      { label: 'Dividends Paid', key: 'dividendsPaid' },
      { label: 'Investing CF', key: 'investingCF' },
      { label: 'Financing CF', key: 'financingCF' },
    ];

    const activeRows = financialsStmt === 'income' ? incomeRows
      : financialsStmt === 'balance' ? balanceRows
      : cashRows;

    const getVal = (p: FinancialPeriod, key: string): number | null => {
      if (key === '_grossMargin') return p.revenue && p.grossProfit != null ? p.grossProfit / p.revenue : null;
      if (key === '_opMargin') return p.revenue && p.operatingIncome != null ? p.operatingIncome / p.revenue : null;
      if (key === '_ebitdaMargin') return p.revenue && p.ebitda != null ? p.ebitda / p.revenue : null;
      if (key === '_netMargin') return p.revenue && p.netIncome != null ? p.netIncome / p.revenue : null;
      if (key === '_freeCF') return p.operatingCF != null && p.capex != null ? p.operatingCF - p.capex : null;
      if (key === '_fcfMargin') { const fcf = p.operatingCF != null && p.capex != null ? p.operatingCF - p.capex : null; return p.revenue && fcf != null ? fcf / p.revenue : null; }
      return (p as unknown as Record<string, unknown>)[key] as number | null;
    };

    const fmtV = (v: number | null, isEps?: boolean, isMeta?: boolean, isShares?: boolean): string => {
      if (v == null) return '—';
      if (isMeta) return `${(v * 100).toFixed(1)}%`;
      if (isEps) return v.toFixed(2);
      if (isShares) {
        const abs = Math.abs(v);
        if (abs >= 1e9) return `${(abs / 1e9).toFixed(2)}B`;
        if (abs >= 1e6) return `${(abs / 1e6).toFixed(0)}M`;
        return abs.toLocaleString('en-US');
      }
      const abs = Math.abs(v);
      const sign = v < 0 ? '-' : '';
      if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
      if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
      if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
      return `${sign}$${abs.toLocaleString('en-US')}`;
    };

    // Keys where a higher value is worse (costs, liabilities, outflows, dilution)
    const inverseKeys = new Set(['costOfRevenue', 'incomeTax', 'interestExpense', 'currentLiabilities', 'shortTermDebt', 'longTermDebt', 'netDebt', 'totalLiabilities', 'capex', 'dividendsPaid', 'financingCF', 'sharesDiluted', 'sbc', 'goodwill']);

    const valColor = (v: number | null, prevV: number | null, key: string, isMeta?: boolean): string => {
      if (v == null) return '#475569';
      if (isMeta) return v >= 0 ? '#94a3b8' : '#ef4444';
      if (prevV == null || v === prevV) return '#e2e8f0';
      const wentUp = v > prevV;
      const upIsGood = !inverseKeys.has(key);
      if (wentUp) return upIsGood ? '#22c55e' : '#f87171';
      return upIsGood ? '#f87171' : '#22c55e';
    };

    return (
      <>
        {/* AI Financials Analysis */}
        {groqKey && (financialsData.length > 0 || finAiAnalysis) && (
          <View style={styles.aiNewsSection}>
            {finAiAnalysis && finAiFreq === financialsFreq ? (
              <View style={styles.aiNewsCard}>
                <View style={styles.aiNewsHeader}>
                  <Ionicons name="sparkles" size={16} color="#a78bfa" />
                  <Text style={styles.aiNewsHeaderText}>AI Financial Analysis · {financialsFreq === 'quarterly' ? 'Quarterly' : 'Annual'}</Text>
                  <TouchableOpacity onPress={() => { setFinAiAnalysis(null); setFinAiError(null); setFinAiFreq(null); }}>
                    <Ionicons name="refresh-outline" size={16} color="#64748b" />
                  </TouchableOpacity>
                </View>
                <MarkdownText text={finAiAnalysis} style={styles.aiNewsBody} />
              </View>
            ) : finAiError ? (
              <View style={styles.aiNewsCard}>
                <Text style={[styles.aiNewsBody, { color: '#f87171' }]}>{finAiError}</Text>
                <TouchableOpacity style={[styles.aiNewsBtn, { marginTop: 10 }]} onPress={() => { setFinAiError(null); }}>
                  <Text style={styles.aiNewsBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.aiNewsBtn}
                disabled={finAiLoading}
                onPress={async () => {
                  setFinAiLoading(true);
                  setFinAiError(null);
                  setFinAiAnalysis(null);
                  try {
                    let earningsData = earnings;
                    if (earningsData.length === 0) {
                      try { earningsData = await getEarnings(symbol, 'quarter'); } catch { /* ok */ }
                    }
                    let ac = analystConsensus;
                    if (!ac) {
                      try { const r = await getAnalystData(symbol); ac = r.consensus; } catch { /* ok */ }
                    }
                    const result = await analyzeFinancialsWithAI(
                      groqKey, symbol, name, financialsFreq, financialsData, earningsData, ac, fundamentals,
                    );
                    setFinAiAnalysis(result);
                    setFinAiFreq(financialsFreq);
                  } catch (e: any) {
                    setFinAiError(e.message ?? 'AI analysis failed.');
                  } finally {
                    setFinAiLoading(false);
                  }
                }}
              >
                {finAiLoading ? (
                  <ActivityIndicator size="small" color="#a78bfa" />
                ) : (
                  <Ionicons name="sparkles" size={15} color="#a78bfa" />
                )}
                <Text style={styles.aiNewsBtnText}>
                  {finAiLoading ? 'Analyzing financials…' : `Analyze ${financialsFreq === 'quarterly' ? 'quarterly' : 'annual'} results with AI`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Statement selector */}
        <View style={{ flexDirection: 'row', marginTop: 12, marginBottom: 8, backgroundColor: '#1b2023', borderRadius: 8, padding: 2, gap: 2 }}>
          {(['income', 'balance', 'cashflow'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              style={[{ flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 6 }, financialsStmt === s && { backgroundColor: '#6366f1' }]}
              onPress={() => setFinancialsStmt(s)}
            >
              <Text style={{ color: financialsStmt === s ? '#fff' : '#8f99aa', fontSize: 11, fontWeight: '600' }}>
                {s === 'income' ? 'Income Stmt' : s === 'balance' ? 'Balance Sheet' : 'Cash Flow'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Period toggle + Charts button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', backgroundColor: '#1b2023', borderRadius: 8, padding: 2 }}>
          {(['quarterly', 'annual'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 6 }, financialsFreq === f && { backgroundColor: '#6366f1' }]}
              onPress={() => setFinancialsFreq(f)}
            >
              <Text style={{ color: financialsFreq === f ? '#fff' : '#8f99aa', fontSize: 12, fontWeight: '600' }}>
                {f === 'quarterly' ? 'Quarterly' : 'Annual'}
              </Text>
            </TouchableOpacity>
          ))}
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('FinancialCharts', { data: financialsData, freq: financialsFreq, symbol })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#1b2023' }}
          >
            <Ionicons name="bar-chart-outline" size={14} color="#6366f1" />
            <Text style={{ color: '#6366f1', fontSize: 12, fontWeight: '600' }}>Charts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('DynamicCharts', { data: financialsData, freq: financialsFreq, symbol })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#1b2023' }}
          >
            <Ionicons name="analytics-outline" size={14} color="#0ea5e9" />
            <Text style={{ color: '#0ea5e9', fontSize: 12, fontWeight: '600' }}>Custom</Text>
          </TouchableOpacity>
        </View>

        {/* Table */}
        {financialsLoading
          ? <ActivityIndicator color="#6366f1" style={{ marginVertical: 20 }} />
          : financialsData.length === 0
            ? <Text style={styles.emptyText}>No data available</Text>
            : (
              <View style={{ flexDirection: 'row', backgroundColor: '#15191c', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#2a3036' }}>
                {/* Fixed left label column */}
                <View style={{ width: LABEL_W }}>
                  <View style={{ height: ROW_H, backgroundColor: '#23282d', justifyContent: 'center', paddingHorizontal: 10 }}>
                    <Text style={{ color: '#7f8898', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
                      {financialsFreq === 'quarterly' ? 'QUARTERLY' : 'ANNUAL'}
                    </Text>
                  </View>
                  {activeRows.map((row, i) => {
                    const glossary = FUND_GLOSSARY[row.label];
                    return (
                      <View
                        key={row.key}
                        style={{ height: ROW_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, backgroundColor: i % 2 === 0 ? '#1b2023' : '#171c1f', borderTopWidth: 1, borderTopColor: '#262d33' }}
                      >
                        <Text
                          style={{ color: row.isMeta ? '#6f7785' : row.bold ? '#f5f7fa' : '#c3cad5', fontSize: row.isMeta ? 10 : 12, fontWeight: row.bold ? '700' : '400', fontStyle: row.isMeta ? 'italic' : 'normal', flexShrink: 1 }}
                          numberOfLines={1}
                        >
                          {row.label}
                        </Text>
                        {glossary && (
                          <Pressable
                            onPress={() => setInfoModal(glossary)}
                            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                            style={{ marginLeft: 4 }}
                          >
                            <Text style={{ color: '#9fb2d9', fontSize: 12, lineHeight: 16 }}>ⓘ</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* Scrollable data columns */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                  <View>
                    {/* Period headers */}
                    <View style={{ flexDirection: 'row', height: ROW_H, backgroundColor: '#23282d' }}>
                      {financialsData.map((p) => (
                        <View key={p.endDate} style={{ width: COL_W, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 10 }}>
                          <Text style={{ color: '#b5becb', fontSize: 11, fontWeight: '700' }}>{p.label}</Text>
                        </View>
                      ))}
                    </View>
                    {/* Data rows */}
                    {activeRows.map((row, i) => (
                      <View key={row.key} style={{ flexDirection: 'row', height: ROW_H, backgroundColor: i % 2 === 0 ? '#1b2023' : '#171c1f', borderTopWidth: 1, borderTopColor: '#262d33' }}>
                        {financialsData.map((p, colIdx) => {
                          const v = getVal(p, row.key);
                          // adjacent column — used for main value color (trend vs previous period)
                          const adjV = colIdx + 1 < financialsData.length ? getVal(financialsData[colIdx + 1], row.key) : null;
                          // YoY: same quarter previous year (quarterly) or previous year (annual)
                          const yoyPeriod = financialsFreq === 'quarterly'
                            ? financialsData.find(d => d.year === p.year - 1 && d.quarter === p.quarter)
                            : financialsData[colIdx + 1];
                          const yoyV = yoyPeriod ? getVal(yoyPeriod, row.key) : null;
                          // YoY% — only for non-meta value rows
                          const yoy: number | null = (!row.isMeta && !row.isEps && !row.isShares && v != null && yoyV != null && yoyV !== 0)
                            ? ((v - yoyV) / Math.abs(yoyV)) * 100
                            : null;
                          const yoyPos = yoy != null && yoy >= 0;
                          const isInv = new Set(['costOfRevenue','incomeTax','interestExpense','currentLiabilities','shortTermDebt','longTermDebt','netDebt','totalLiabilities','capex','dividendsPaid','financingCF','sharesDiluted','sbc','goodwill']).has(row.key);
                          const yoyColor = yoy == null ? 'transparent' : (isInv ? (!yoyPos ? '#22c55e' : '#ef4444') : (yoyPos ? '#22c55e' : '#ef4444'));
                          return (
                            <View key={p.endDate} style={{ width: COL_W, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 10, gap: 1 }}>
                              <Text style={{ color: valColor(v, adjV, row.key, row.isMeta), fontSize: row.isMeta ? 11 : 12, fontWeight: row.bold ? '600' : '400' }}>
                                {fmtV(v, row.isEps, row.isMeta, row.isShares)}
                              </Text>
                              {yoy != null && (
                                <Text style={{ color: yoyColor, fontSize: 9.5, fontWeight: '500' }}>
                                  {yoyPos ? '+' : ''}{yoy.toFixed(1)}%
                                </Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )
        }
        <View style={{ height: 30 }} />
      </>
    );
  };

  const NoticiasTab = () => {
    const activeNews = newsSource === 'yahoo' ? news : finnhubNews;
    const activeLoading = newsSource === 'yahoo' ? newsLoading : finnhubNewsLoading;
    const currentNewsForAI = activeNews;

    return (
      <>
        {/* Source selector */}
        <View style={{ flexDirection: 'row', backgroundColor: '#1b2023', borderRadius: 8, padding: 2, marginTop: 12, marginBottom: 12, alignSelf: 'flex-start' }}>
          {(['yahoo', 'finnhub'] as const).map((src) => (
            <TouchableOpacity
              key={src}
              style={[{ paddingHorizontal: 16, paddingVertical: 5, borderRadius: 6 }, newsSource === src && { backgroundColor: '#6366f1' }]}
              onPress={() => setNewsSource(src)}
            >
              <Text style={{ color: newsSource === src ? '#fff' : '#8f99aa', fontSize: 12, fontWeight: '600' }}>
                {src === 'yahoo' ? 'Yahoo Finance' : 'Finnhub'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* AI News Analysis button */}
        {groqKey ? (
          <View style={styles.aiNewsSection}>
            {newsAiAnalysis ? (
              <View style={styles.aiNewsCard}>
                <View style={styles.aiNewsHeader}>
                  <Ionicons name="sparkles" size={16} color="#a78bfa" />
                  <Text style={styles.aiNewsHeaderText}>AI News Analysis</Text>
                  <TouchableOpacity onPress={() => { setNewsAiAnalysis(null); setNewsAiError(null); }}>
                    <Ionicons name="refresh-outline" size={16} color="#64748b" />
                  </TouchableOpacity>
                </View>
                <MarkdownText text={newsAiAnalysis} style={styles.aiNewsBody} />
              </View>
            ) : newsAiError ? (
              <View style={styles.aiNewsCard}>
                <Text style={[styles.aiNewsBody, { color: '#f87171' }]}>{newsAiError}</Text>
                <TouchableOpacity style={styles.aiNewsBtn} onPress={() => { setNewsAiError(null); }}>
                  <Text style={styles.aiNewsBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : currentNewsForAI.length > 0 ? (
              <TouchableOpacity
                style={styles.aiNewsBtn}
                disabled={newsAiLoading}
                onPress={async () => {
                  setNewsAiLoading(true);
                  setNewsAiError(null);
                  try {
                    const result = await analyzeNewsWithAI(groqKey, symbol, name, currentPrice, currency, currentNewsForAI);
                    setNewsAiAnalysis(result);
                  } catch (e: any) {
                    setNewsAiError(e.message ?? 'AI analysis failed.');
                  } finally {
                    setNewsAiLoading(false);
                  }
                }}
              >
                {newsAiLoading ? (
                  <ActivityIndicator size="small" color="#a78bfa" />
                ) : (
                  <Ionicons name="sparkles" size={15} color="#a78bfa" />
                )}
                <Text style={styles.aiNewsBtnText}>
                  {newsAiLoading ? 'Analyzing news…' : 'Analyze news with AI'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* News list */}
        {activeLoading ? (
          <ActivityIndicator color="#6366f1" style={{ marginVertical: 20 }} />
        ) : activeNews.length === 0 ? (
          <Text style={styles.emptyText}>No news available</Text>
        ) : (
          activeNews.map((item) => (
            <TouchableOpacity key={item.link} style={styles.newsCard} onPress={() => Linking.openURL(item.link)}>
              <Text style={styles.newsTitle}>{item.title}</Text>
              <View style={styles.newsMeta}>
                <Text style={styles.newsPublisher}>{item.publisher}</Text>
                <Text style={styles.newsDate}>
                  {new Date(item.publishTime * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
        {(newsSource === 'yahoo' ? newsLoadingMore : finnhubNewsLoadingMore) && (
          <ActivityIndicator color="#6366f1" style={{ marginVertical: 12 }} />
        )}
        {!(newsSource === 'yahoo' ? newsHasMore : finnhubNewsHasMore) && activeNews.length > 0 && (
          <Text style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>No more news</Text>
        )}
        <View style={{ height: 30 }} />
      </>
    );
  };

  return (
    <View style={styles.container}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      scrollEnabled={true}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" colors={['#6366f1']} />
      }
      onScroll={({ nativeEvent }) => {
        if (activeTab !== 'news') return;
        const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
        const nearBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 200;
        if (!nearBottom) return;
        if (newsSource === 'yahoo' && !newsLoadingMore && newsHasMore) {
          const nextPage = newsPage + 1;
          setNewsLoadingMore(true);
          getNews(symbol, nextPage).then((items) => {
            if (items.length > 0) {
              setNews((prev) => {
                const existingLinks = new Set(prev.map((n) => n.link));
                const fresh = items.filter((n) => !existingLinks.has(n.link));
                return [...prev, ...fresh];
              });
              setNewsPage(nextPage);
              setNewsHasMore(items.length >= 10);
            } else {
              setNewsHasMore(false);
            }
          }).catch(() => {}).finally(() => setNewsLoadingMore(false));
        }
        if (newsSource === 'finnhub' && !finnhubNewsLoadingMore && finnhubNewsHasMore) {
          const nextPage = finnhubNewsPage + 1;
          setFinnhubNewsLoadingMore(true);
          getFinnhubNews(symbol, nextPage).then((items) => {
            if (items.length > 0) {
              setFinnhubNews((prev) => {
                const existingLinks = new Set(prev.map((n) => n.link));
                const fresh = items.filter((n) => !existingLinks.has(n.link));
                return [...prev, ...fresh];
              });
              setFinnhubNewsPage(nextPage);
              setFinnhubNewsHasMore(items.length >= 5);
            } else {
              setFinnhubNewsHasMore(false);
            }
          }).catch(() => {}).finally(() => setFinnhubNewsLoadingMore(false));
        }
      }}
      scrollEventThrottle={200}
    >
      <View style={isDesktop ? styles.desktopRow : undefined}>
      <View style={isDesktop ? styles.desktopLeft : undefined}>
      {/* Header */}
      <View style={styles.headerRow}>
        {fundamentals?.logoUrl ? (
          <Image
            source={{ uri: fundamentals.logoUrl }}
            style={styles.logoImg}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.tickerBadge}>
            <Text style={styles.tickerText}>{symbol.slice(0, 2)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.symbolText}>{symbol}</Text>
          <Text style={styles.nameText} numberOfLines={1}>{name}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {quote?.marketState && (
              <TouchableOpacity onPress={() => setMarketHoursVisible(true)} hitSlop={8} activeOpacity={0.7}>
                {quote.marketState === 'PRE' && (
                  <View style={[styles.marketBadge, { borderWidth: 1, borderColor: '#fb923c66', flexDirection: 'row', alignItems: 'center', gap: 3 }]}>
                    <Ionicons name="time-outline" size={10} color="#fb923c" />
                    <Text style={styles.marketBadgeTxt}>PRE</Text>
                  </View>
                )}
                {(quote.marketState === 'POST' || quote.marketState === 'POSTPOST') && (
                  <View style={[styles.marketBadge, styles.marketBadgePost, { borderWidth: 1, borderColor: '#93c5fd66', flexDirection: 'row', alignItems: 'center', gap: 3 }]}>
                    <Ionicons name="time-outline" size={10} color="#93c5fd" />
                    <Text style={[styles.marketBadgeTxt, { color: '#93c5fd' }]}>AFTER</Text>
                  </View>
                )}
                {quote.marketState === 'REGULAR' && (
                  <View style={[styles.marketBadge, styles.marketBadgeRegular, { borderWidth: 1, borderColor: '#86efac66', flexDirection: 'row', alignItems: 'center', gap: 3 }]}>
                    <Ionicons name="radio-button-on" size={10} color="#86efac" />
                    <Text style={[styles.marketBadgeTxt, { color: '#86efac' }]}>OPEN</Text>
                  </View>
                )}
                {(quote.marketState === 'CLOSED' || quote.marketState === 'PREPRE') && (
                  <View style={[styles.marketBadge, styles.marketBadgeClosed, { borderWidth: 1, borderColor: '#47556966', flexDirection: 'row', alignItems: 'center', gap: 3 }]}>
                    <Ionicons name="time-outline" size={10} color="#94a3b8" />
                    <Text style={[styles.marketBadgeTxt, { color: '#94a3b8' }]}>CLOSED</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            <Text style={styles.priceText}>
              {(candleCrosshair.visible ? candleCrosshair.price : nativePrice).toFixed(2)} {nativeCurrencySymbol}
              {!sameAsCurrency ? <Text style={styles.priceSecondary}>{' '}/ {(candleCrosshair.visible ? candleCrosshair.price * fxRate : currentPrice).toFixed(2)} {currencySymbol}</Text> : null}
            </Text>
          </View>
          <Text style={[styles.dailyChange, { color: periodPos ? '#22c55e' : '#ef4444' }]}>
            {(() => {
              const refPrice = selectedPeriod === '1D' ? periodRef1D : firstVisible;
              const dispPrice = candleCrosshair.visible ? candleCrosshair.price : lastVisible;
              const diff = dispPrice - refPrice;
              const pct = refPrice > 0 ? (diff / refPrice) * 100 : 0;
              return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ${nativeCurrencySymbol}  (${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
            })()}
          </Text>
        </View>
      </View>

      {/* Chart type toggle */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        <ChartTypeToggleButton
          value={chartType}
          onChange={(next) => {
            if (next === 'line') {
              setChartType('line');
              setCandleVisibleClose([]);
              setCandleVisibleTimestamps([]);
              setCandleCrosshair({ visible: false, price: 0, ts: 0 });
              setVisibleData({ prices: [], timestamps: [] });
              return;
            }

            setChartType('candle');
            setCandleVisibleClose([]);
            setCandleVisibleTimestamps([]);
            setVisibleData({ prices: [], timestamps: [] });
          }}
        />
      </View>

      {/* Chart */}
      <View style={styles.chartWrapper}>
        {chartType === 'line' ? (
          <InteractiveChart
            key={`${showCustomRange ? `custom-${customFrom}-${customTo}` : selectedPeriod}-${chartDisplayData.timestamps.length}`}
            prices={chartDisplayData.prices}
            timestamps={chartDisplayData.timestamps}
            initialPoints={showCustomRange ? chartDisplayData.prices.length : pointsForPeriod(chartDisplayData.timestamps, selectedPeriod)}
            color={chartColor}
            height={CHART_H}
            loading={chartLoading}
            avgPrice={shares > 0 && avgPrice > 0 ? avgPrice : undefined}
            onVisibleChange={(vp, vt) => setVisibleData({ prices: vp, timestamps: vt })}
            renderOverlay={(vp, vt, ph, sw, pMin, pMax) => {
              if (vp.length < 2) return null;
              const priceRange = Math.max(pMax - pMin, 1);
              const interval = vt.length > 1 ? Math.abs(vt[1] - vt[0]) : Infinity;
              const dots: { cx: number; cy: number; isSell: boolean }[] = [];
              transactions.filter((t) => t.symbol === symbol).forEach((t) => {
                const buyTs = new Date(t.date).getTime() / 1000;
                let bestIdx = -1, bestDiff = Infinity;
                vt.forEach((ts, i) => { const d = Math.abs(ts - buyTs); if (d < bestDiff) { bestDiff = d; bestIdx = i; } });
                if (bestIdx === -1 || bestDiff > interval * 3) return;
                const cx = (bestIdx / (vp.length - 1)) * sw;
                const cy = CH_PAD_TOP + ph * (1 - (vp[bestIdx] - pMin) / priceRange);
                const isDup = dots.some(d => Math.abs(d.cx - cx) < 6 && Math.abs(d.cy - cy) < 6);
                if (!isDup) dots.push({ cx, cy, isSell: t.type === 'sell' });
              });
              if (dots.length === 0) return null;
              return (
                <Svg style={StyleSheet.absoluteFill} width={sw} height={CHART_H}>
                  {dots.map((d, i) => (
                    <SvgCircle key={i} cx={d.cx} cy={d.cy} r={d.isSell ? 5 : 7} fill={d.isSell ? '#ef4444' : '#22c55e'} stroke="#0f172a" strokeWidth={2} />
                  ))}
                </Svg>
              );
            }}
            renderTooltip={(price, ts) => (
              <>
                <Text style={styles.crosshairDate}>{new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                <Text style={styles.crosshairPrice}>{(price * fxRate).toFixed(2)} {currencySymbol}{!sameAsCurrency ? ` (${price.toFixed(2)} ${nativeCurrencySymbol})` : ''}</Text>
              </>
            )}
          />
        ) : (
          <View style={{ position: 'relative' }}>
          <CandlestickChart
            key={`candle-${showCustomRange ? `custom-${customFrom}-${customTo}` : selectedPeriod}`}
            open={candleDisplayData.open}
            high={candleDisplayData.high}
            low={candleDisplayData.low}
            close={candleDisplayData.close}
            timestamps={candleDisplayData.timestamps}
            initialPoints={showCustomRange ? candleDisplayData.timestamps.length : pointsForPeriod(candleDisplayData.timestamps, selectedPeriod)}
            height={CHART_H}
            loading={candleLoading}
            avgPrice={shares > 0 && avgPrice > 0 ? avgPrice : undefined}
            onCrosshairChange={(visible, price, ts) => {
              setCandleCrosshair({ visible, price, ts });
            }}
            onVisibleChange={(closes, timestamps) => {
              setCandleVisibleClose(closes);
              setCandleVisibleTimestamps(timestamps);
            }}
          />
          {(() => {
            if (candleVisibleClose.length < 2 || candleVisibleTimestamps.length < 2) return null;
            const priceMin = Math.min(...candleVisibleClose);
            const priceMax = Math.max(...candleVisibleClose);
            const priceRange = Math.max(priceMax - priceMin, 1);
            const interval = candleVisibleTimestamps.length > 1 ? Math.abs(candleVisibleTimestamps[1] - candleVisibleTimestamps[0]) : Infinity;
            const plotW = SCREEN_WIDTH - 44;
            const plotH = CHART_H - CH_PAD_TOP - 30;
            const dots: { cx: number; cy: number; isSell: boolean }[] = [];

            transactions.filter((t) => t.symbol === symbol).forEach((t) => {
              const txTs = new Date(t.date).getTime() / 1000;
              let bestIdx = -1;
              let bestDiff = Infinity;
              candleVisibleTimestamps.forEach((ts, i) => {
                const diff = Math.abs(ts - txTs);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestIdx = i;
                }
              });
              if (bestIdx === -1 || bestDiff > interval * 3) return;
              const cx = (bestIdx / Math.max(1, candleVisibleClose.length - 1)) * plotW;
              const cy = CH_PAD_TOP + plotH * (1 - (candleVisibleClose[bestIdx] - priceMin) / priceRange);
              const isDup = dots.some((d) => Math.abs(d.cx - cx) < 6 && Math.abs(d.cy - cy) < 6 && d.isSell === (t.type === 'sell'));
              if (!isDup) dots.push({ cx, cy, isSell: t.type === 'sell' });
            });

            if (dots.length === 0) return null;

            return (
              <Svg style={StyleSheet.absoluteFill} width={SCREEN_WIDTH} height={CHART_H} pointerEvents="none">
                {dots.map((d, i) => (
                  <SvgCircle key={i} cx={d.cx} cy={d.cy} r={d.isSell ? 5 : 7} fill={d.isSell ? '#ef4444' : '#22c55e'} stroke="#0f172a" strokeWidth={2} />
                ))}
              </Svg>
            );
          })()}
          {candleCrosshair.visible && (
            <View style={[styles.crosshairTooltip, { pointerEvents: 'none' }]}>
              <Text style={styles.crosshairDate}>{new Date(candleCrosshair.ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
              <Text style={styles.crosshairPrice}>{(candleCrosshair.price * fxRate).toFixed(2)} {currencySymbol}{!sameAsCurrency ? ` (${candleCrosshair.price.toFixed(2)} ${nativeCurrencySymbol})` : ''}</Text>
            </View>
          )}
          </View>
        )}
      </View>

      {/* Period row */}
      <View style={styles.periodsRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, !showCustomRange && selectedPeriod === p && styles.periodBtnActive]}
            onPress={() => { setShowCustomRange(false); setSelectedPeriod(p); setVisibleData({ prices: [], timestamps: [] }); }}
          >
            <Text style={[styles.periodTxt, !showCustomRange && selectedPeriod === p && styles.periodTxtActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.periodBtn, showCustomRange && styles.periodBtnActive]}
          onPress={() => { setShowCustomRange(v => !v); setVisibleData({ prices: [], timestamps: [] }); }}
        >
          <Text style={[styles.periodTxt, showCustomRange && styles.periodTxtActive]}>Custom</Text>
        </TouchableOpacity>
      </View>
      {showCustomRange && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
          <TextInput
            value={customFrom}
            onChangeText={setCustomFrom}
            placeholder="From YYYY-MM-DD"
            placeholderTextColor="#475569"
            style={{ flex: 1, color: '#f1f5f9', backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 }}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <Text style={{ color: '#64748b', fontSize: 14 }}>→</Text>
          <TextInput
            value={customTo}
            onChangeText={setCustomTo}
            placeholder="To YYYY-MM-DD"
            placeholderTextColor="#475569"
            style={{ flex: 1, color: '#f1f5f9', backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 }}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        </View>
      )}
      {isDesktop && (
        <View style={{ borderTopWidth: 1, borderTopColor: '#1e293b' }}>
          {DividendosTab()}
        </View>
      )}
      </View>
      <View style={isDesktop ? styles.desktopRight : undefined}>
      <View style={styles.tabBar}>
        {(['overview', 'portfolio', 'dividends', 'financials', 'news', 'analysts'] as Tab[])
          .filter(tab => !isDesktop || tab !== 'dividends')
          .map((tab) => (
          <TouchableOpacity key={tab} style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabTxt, activeTab === tab && styles.tabTxtActive]}>
              {tab === 'overview' ? 'Overview' : tab === 'portfolio' ? 'Portfolio' : tab === 'dividends' ? 'Dividends' : tab === 'financials' ? 'Financials' : tab === 'analysts' ? 'Analysts' : 'News'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      <View style={styles.tabContent}>
        {activeTab === 'overview' && FundamentosTab()}
        {activeTab === 'portfolio'   && PortfolioTab()}
        {activeTab === 'dividends'   && DividendosTab()}
        {activeTab === 'financials'  && FinancialsTab()}
        {activeTab === 'news'        && NoticiasTab()}
        {activeTab === 'analysts'    && AnalistasTab()}
      </View>
      </View>
      </View>
    </ScrollView>

    {/* Kebab popover for transaction rows on desktop */}
    <Modal
      visible={txKebabPos !== null}
      transparent
      animationType="none"
      onRequestClose={closeTxKebab}
    >
      <Pressable style={StyleSheet.absoluteFillObject} onPress={closeTxKebab}>
        <Pressable
          style={{
            position: 'absolute',
            top: txKebabPos?.top ?? 0,
            right: txKebabPos?.right ?? 0,
            backgroundColor: '#1e293b',
            borderRadius: 12,
            paddingVertical: 6,
            minWidth: 160,
            shadowColor: '#000',
            shadowOpacity: 0.5,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 6 },
          }}
          onPress={() => {}}
        >
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14 }}
            onPress={() => {
              const tx = myTxs.find(t => t.id === txKebabId);
              closeTxKebab();
              if (tx) {
                if (isCombinedPortfolio) { Alert.alert('Read-only', 'Select a specific portfolio before editing transactions.'); return; }
                openEditTx(tx);
              }
            }}
          >
            <Ionicons name="pencil-outline" size={16} color="#94a3b8" style={{ marginRight: 10 }} />
            <Text style={{ color: '#f1f5f9', fontSize: 14 }}>Edit</Text>
          </TouchableOpacity>
          <View style={{ height: 1, backgroundColor: '#334155', marginVertical: 2 }} />
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14 }}
            onPress={() => {
              const id = txKebabId;
              closeTxKebab();
              if (id) {
                if (isCombinedPortfolio) { Alert.alert('Read-only', 'Select a specific portfolio before deleting transactions.'); return; }
                confirmDeleteTx(id);
              }
            }}
          >
            <Ionicons name="trash-outline" size={16} color="#ef4444" style={{ marginRight: 10 }} />
            <Text style={{ color: '#ef4444', fontSize: 14 }}>Delete</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>

    {/* Modal — adicionar transação */}
    <Modal
      visible={txModalVisible}
      transparent
      animationType="none"
      onRequestClose={() => setTxModalVisible(false)}
    >
      {txModalVisible && (
        <AddTransactionModal
          symbol={symbol}
          name={name}
          initialPrice={nativePrice > 0 ? nativePrice.toFixed(2) : ''}
          nativeCurrencySymbol={nativeCurrencySymbol}
          onClose={() => setTxModalVisible(false)}
        />
      )}
    </Modal>

    {/* Overlay — price alerts (absolute, avoids RN Modal conflicts) */}
    {alertModalVisible && (
      <PriceAlertModal
        symbol={symbol}
        name={name}
        currentPrice={nativePrice}
        currencySymbol={nativeCurrencySymbol}
        onClose={() => setAlertModalVisible(false)}
      />
    )}

    {/* Overlay — glossário de fundamentos (absolute, avoids RN Modal bugs on Android) */}
    {infoModal !== null && (
      <Pressable
        style={[StyleSheet.absoluteFillObject, styles.infoOverlay]}
        onPress={() => setInfoModal(null)}
      >
        <Pressable style={styles.infoCard} onPress={() => {}}>
          <Text style={styles.infoTitle}>{infoModal.title}</Text>
          <View style={styles.infoSep} />
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.infoDesc}>{infoModal.desc}</Text>
          </ScrollView>
          <TouchableOpacity style={styles.infoCloseBtn} onPress={() => setInfoModal(null)}>
            <Text style={styles.infoCloseTxt}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    )}

    {/* Earnings card overlay */}
    {earningsCard !== null && (() => {
      const { event: ev, idx: evIdx } = earningsCard;
      const epsActual = ev.epsActual;
      const epsEst = ev.epsEstimated;
      const revActual = ev.revenueActual;
      const revEst = ev.revenueEstimated;

      // Use pre-calculated surprisePct from AV (authoritative, non-GAAP adjusted basis)
      const epsSurprisePct = ev.surprisePct ?? (epsActual != null && epsEst != null && epsEst !== 0
        ? ((epsActual - epsEst) / Math.abs(epsEst)) * 100 : null);
      const revSurprisePct = revActual != null && revEst != null && revEst !== 0
        ? ((revActual - revEst) / Math.abs(revEst)) * 100 : null;

      const epsYoy4 = earnings[evIdx + 4]?.epsActual ?? null;
      const revYoy4 = earnings[evIdx + 4]?.revenueActual ?? null;
      const epsYoyPctRaw = epsActual != null && epsYoy4 != null && epsYoy4 !== 0
        ? ((epsActual - epsYoy4) / Math.abs(epsYoy4)) * 100 : null;
      const revYoyPctRaw = revActual != null && revYoy4 != null && revYoy4 !== 0
        ? ((revActual - revYoy4) / Math.abs(revYoy4)) * 100 : null;
      // Fall back to fundamentals TTM YoY when earnings array doesn't go back far enough
      const epsYoyPct = epsYoyPctRaw ?? (fundamentals?.earningsGrowth != null ? fundamentals.earningsGrowth * 100 : null);
      const revYoyPct = revYoyPctRaw ?? (fundamentals?.revenueGrowth != null ? fundamentals.revenueGrowth * 100 : null);

      const epsQoqPrev = earnings[evIdx + 1]?.epsActual ?? null;
      const revQoqPrev = earnings[evIdx + 1]?.revenueActual ?? null;
      const epsQoqPct = epsActual != null && epsQoqPrev != null && epsQoqPrev !== 0
        ? ((epsActual - epsQoqPrev) / Math.abs(epsQoqPrev)) * 100 : null;
      const revQoqPct = revActual != null && revQoqPrev != null && revQoqPrev !== 0
        ? ((revActual - revQoqPrev) / Math.abs(revQoqPrev)) * 100 : null;

      const fmtEpsCard = (v: number | null) => v != null ? `$${v.toFixed(2)}` : '—';
      const fmtRevCard = (v: number | null) => {
        if (v == null) return '—';
        if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
        if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
        return `$${v.toFixed(2)}`;
      };

      const dp = ev.date.split('-');
      const dateStr = dp.length === 3 ? `${dp[2]}.${dp[1]}.${dp[0]}` : ev.date;

      type StatRow = { label: string; dir: 'up' | 'down'; pct: string; period: string };
      const statRows: StatRow[] = ([
        epsYoyPct != null ? { label: 'EPS', dir: epsYoyPct >= 0 ? 'up' : 'down', pct: Math.abs(epsYoyPct).toFixed(0) + '%', period: 'Year Over Year' } : null,
        revYoyPct != null ? { label: 'Revenue', dir: revYoyPct >= 0 ? 'up' : 'down', pct: Math.abs(revYoyPct).toFixed(0) + '%', period: 'Year Over Year' } : null,
        epsQoqPct != null ? { label: 'EPS', dir: epsQoqPct >= 0 ? 'up' : 'down', pct: Math.abs(epsQoqPct).toFixed(0) + '%', period: 'Quarter Over Quarter' } : null,
        revQoqPct != null ? { label: 'Revenue', dir: revQoqPct >= 0 ? 'up' : 'down', pct: Math.abs(revQoqPct).toFixed(0) + '%', period: 'Quarter Over Quarter' } : null,
      ] as (StatRow | null)[]).filter((r): r is StatRow => r !== null);

      return (
        <Pressable
          key="earnings-card-overlay"
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 999, elevation: 99, justifyContent: 'center', alignItems: 'center', padding: 20 }]}
          onPress={() => setEarningsCard(null)}
        >
          <Pressable onPress={e2 => e2.stopPropagation()} style={{ backgroundColor: '#1b2023', borderRadius: 14, width: '100%', borderWidth: 1, borderColor: '#303841' }}>

            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#262d33' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                {fundamentals?.logoUrl
                  ? <Image source={{ uri: fundamentals.logoUrl }} style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: '#23282d' }} />
                  : <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: '#23282d', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#94a3b8', fontWeight: '700', fontSize: 13 }}>{symbol.slice(0, 2)}</Text>
                    </View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{name}</Text>
                  <Text style={{ color: '#8f99aa', fontSize: 12, marginTop: 1 }}>Earnings Results · {dateStr}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setEarningsCard(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color="#8f99aa" />
              </TouchableOpacity>
            </View>

            {/* Table */}
            <View style={{ marginHorizontal: 12, marginTop: 12 }}>
              {/* Table header */}
              <View style={{ flexDirection: 'row', backgroundColor: '#23282d', borderRadius: 6, paddingVertical: 7, paddingHorizontal: 4, marginBottom: 4 }}>
                <Text style={{ flex: 1.3, color: '#b5becb', fontWeight: '600', fontSize: 11, textAlign: 'center' }}>Parameter</Text>
                <Text style={{ flex: 1, color: '#b5becb', fontWeight: '600', fontSize: 11, textAlign: 'center' }}>Expected</Text>
                <Text style={{ flex: 1, color: '#b5becb', fontWeight: '600', fontSize: 11, textAlign: 'center' }}>Actual</Text>
                <Text style={{ flex: 1, color: '#b5becb', fontWeight: '600', fontSize: 11, textAlign: 'center' }}>Beat/Miss</Text>
              </View>
              {/* EPS row */}
              <View style={{ flexDirection: 'row', backgroundColor: '#23282d', paddingVertical: 9, paddingHorizontal: 4, marginBottom: 3, borderRadius: 6 }}>
                <Text style={{ flex: 1.3, color: '#d8dee8', fontWeight: '600', fontSize: 12, textAlign: 'center' }}>EPS</Text>
                <Text style={{ flex: 1, color: '#b5becb', fontSize: 12, textAlign: 'center' }}>{fmtEpsCard(epsEst)}</Text>
                <Text style={{ flex: 1, color: '#e2e8f0', fontWeight: '700', fontSize: 12, textAlign: 'center' }}>{fmtEpsCard(epsActual)}</Text>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  {epsSurprisePct != null
                    ? <Text style={{ color: epsSurprisePct >= 0 ? '#22c55e' : '#ef4444', fontWeight: '700', fontSize: 11 }}>
                        {epsSurprisePct >= 0 ? `+${epsSurprisePct.toFixed(0)}%` : `${epsSurprisePct.toFixed(0)}%`}
                      </Text>
                    : <Text style={{ color: '#6f7785', fontSize: 11 }}>—</Text>
                  }
                </View>
              </View>
              {/* Revenue row */}
              <View style={{ flexDirection: 'row', backgroundColor: '#23282d', paddingVertical: 9, paddingHorizontal: 4, borderRadius: 6 }}>
                <Text style={{ flex: 1.3, color: '#d8dee8', fontWeight: '600', fontSize: 12, textAlign: 'center' }}>Revenue</Text>
                <Text style={{ flex: 1, color: '#b5becb', fontSize: 12, textAlign: 'center' }}>{fmtRevCard(revEst)}</Text>
                <Text style={{ flex: 1, color: '#e2e8f0', fontWeight: '700', fontSize: 12, textAlign: 'center' }}>{fmtRevCard(revActual)}</Text>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  {revSurprisePct != null
                    ? <Text style={{ color: revSurprisePct >= 0 ? '#22c55e' : '#ef4444', fontWeight: '700', fontSize: 11 }}>
                        {revSurprisePct >= 0 ? `+${revSurprisePct.toFixed(0)}%` : `${revSurprisePct.toFixed(0)}%`}
                      </Text>
                    : <Text style={{ color: '#6f7785', fontSize: 11 }}>—</Text>
                  }
                </View>
              </View>
            </View>

            {/* YoY / QoQ stats */}
            {statRows.length > 0 && (
              <View style={{ marginHorizontal: 12, marginTop: 12, backgroundColor: '#23282d', borderRadius: 8, padding: 12 }}>
                {statRows.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: i < statRows.length - 1 ? 6 : 0 }}>
                    <Text style={{ color: '#cbd5e1', fontWeight: '700', fontSize: 13, width: 64 }}>{s.label}</Text>
                    <Text style={{ color: s.dir === 'up' ? '#22c55e' : '#ef4444', fontWeight: '700', fontSize: 13 }}>
                      {s.dir === 'up' ? '▲' : '▼'} {s.pct}
                    </Text>
                    <Text style={{ color: '#8f99aa', fontSize: 13, marginLeft: 6 }}>{s.period}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={{ height: 14 }} />
          </Pressable>
        </Pressable>
      );
    })()}

    {/* Market hours overlay */}
    {marketHoursVisible && (() => {
      const exchTz = getExchangeTz(symbol, quote?.exchangeTimezone);
      const sessions = EXCHANGE_SESSIONS[exchTz] ?? EXCHANGE_SESSIONS['America/New_York'];
      const exchLabel = TIMEZONE_EXCHANGE_LABEL[exchTz] ?? exchTz;

      // UTC offset shift: device local minutes vs exchange local minutes
      // Use formatToParts — reliable on Hermes, avoids NaN from locale string parsing
      const tzToMin = (tz: string): number => {
        try {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
          }).formatToParts(new Date());
          const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
          const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
          return h * 60 + m;
        } catch { return 0; }
      };
      const deviceTz = Intl.DateTimeFormat?.().resolvedOptions?.().timeZone ?? '';
      const utcOffsetShift = (() => {
        try {
          const devMin = deviceTz ? tzToMin(deviceTz) : (new Date().getHours() * 60 + new Date().getMinutes());
          const exchMin = tzToMin(exchTz);
          return ((devMin - exchMin) + 1440) % 1440 > 720
            ? ((devMin - exchMin) + 1440) % 1440 - 1440
            : ((devMin - exchMin) + 1440) % 1440;
        } catch { return 0; }
      })();
      // Convert exchange-local minutes to device-local minutes (handles midnight wrap)
      const toLocalMin = (m: number): number => ((m + utcOffsetShift) % 1440 + 1440) % 1440;

      // Dot position uses exchange-local time (timeline is in exchange-local)
      let exchNowMin = tzToMin(exchTz);
      let todayLabel = '';
      try {
        todayLabel = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace('/', '.');
      } catch {
        todayLabel = `${String(new Date().getDate()).padStart(2,'0')}.${String(new Date().getMonth()+1).padStart(2,'0')}`;
      }
      // Current device-local time (shown under the dot)
      const nowMin = deviceTz ? tzToMin(deviceTz) : (new Date().getHours() * 60 + new Date().getMinutes());

      // Build timeline in exchange local time (sorted segments, fill closed gaps)
      const sorted = [...sessions].sort((a, b) => a.startMin - b.startMin);
      const timeline: Array<{ type: 'pre'|'regular'|'post'|'closed'; width: number }> = [];
      let cur = 0;
      for (const s of sorted) {
        if (s.startMin > cur) timeline.push({ type: 'closed', width: s.startMin - cur });
        timeline.push({ type: s.type, width: s.endMin - s.startMin });
        cur = s.endMin;
      }
      if (cur < 1440) timeline.push({ type: 'closed', width: 1440 - cur });

      // Build session cards — times converted to device local
      const groupedLocal: Record<string, [number,number][]> = {};
      for (const s of sorted) {
        if (!groupedLocal[s.type]) groupedLocal[s.type] = [];
        groupedLocal[s.type].push([toLocalMin(s.startMin), toLocalMin(s.endMin)]);
      }
      const closedLocal: [number,number][] = [];
      let prev = 0;
      for (const s of sorted) { if (s.startMin > prev) closedLocal.push([toLocalMin(prev), toLocalMin(s.startMin)]); prev = s.endMin; }
      if (prev < 1440) closedLocal.push([toLocalMin(prev), toLocalMin(1440 % 1440)]);

      const ms = quote?.marketState;
      const fmtRange = (s: number, e: number) => e < s ? `${minToStr(s)} – ${minToStr(e)} (+1)` : `${minToStr(s)} – ${minToStr(e)}`;
      const cards = [
        ...(groupedLocal['pre']     ? [{ ...MKT_SESSION_CFG.pre,     ranges: groupedLocal['pre'].map(([s,e]) => fmtRange(s,e)),     active: ms === 'PRE' }] : []),
        ...(groupedLocal['regular'] ? [{ ...MKT_SESSION_CFG.regular, ranges: groupedLocal['regular'].map(([s,e]) => fmtRange(s,e)), active: ms === 'REGULAR' }] : []),
        ...(groupedLocal['post']    ? [{ ...MKT_SESSION_CFG.post,    ranges: groupedLocal['post'].map(([s,e]) => fmtRange(s,e)),    active: ms === 'POST' || ms === 'POSTPOST' }] : []),
        { ...MKT_SESSION_CFG.closed, ranges: closedLocal.filter(([s,e])=>s!==e).map(([s,e]) => fmtRange(s,e)), active: ms === 'CLOSED' || ms === 'PREPRE' },
      ].filter(c => c.ranges.length > 0);

      const dotPct = `${((exchNowMin / 1440) * 100).toFixed(2)}%`;

      return (
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end', zIndex: 999, elevation: 99 }]}
          onPress={() => setMarketHoursVisible(false)}
        >
          <Pressable
            style={{ backgroundColor: '#0f172a', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 }}
            onPress={() => {}}
          >
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <Text style={{ color: '#f8fafc', fontSize: 17, fontWeight: '700' }}>Market Hours</Text>
              <TouchableOpacity onPress={() => setMarketHoursVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 20 }}>Today {todayLabel}  ·  {exchLabel}  ·  <Text style={{ color: '#6366f1' }}>local time</Text></Text>

            {/* Timeline bar */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: '#475569', fontSize: 11 }}>00:00</Text>
              <Text style={{ color: '#475569', fontSize: 11 }}>00:00</Text>
            </View>
            <View style={{ position: 'relative', marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', height: 10, borderRadius: 6, overflow: 'hidden' }}>
                {timeline.map((seg, i) => (
                  <View key={i} style={{ flex: seg.width, backgroundColor: MKT_SESSION_CFG[seg.type].timelineColor }} />
                ))}
              </View>
              {/* Current time dot */}
              <View style={{ position: 'absolute', left: dotPct as any, top: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: '#0f172a', borderWidth: 3, borderColor: '#f1f5f9', marginLeft: -10 }} />
            </View>
            {/* Current time label */}
            <Text style={{ color: '#f1f5f9', fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 20 }}>{minToStr(nowMin)} <Text style={{ color: '#64748b', fontWeight: '400' }}>(local time)</Text></Text>

            {/* Session cards */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
              {cards.map(card => (
                <View
                  key={card.label}
                  style={{ backgroundColor: card.bgColor, borderRadius: 12, padding: 12, minWidth: 100, borderWidth: card.active ? 1.5 : 0, borderColor: card.color }}
                >
                  <Text style={{ color: card.color, fontWeight: '700', fontSize: 13, marginBottom: 8 }}>{card.label}</Text>
                  {card.ranges.map(r => (
                    <Text key={r} style={{ color: card.color, fontSize: 12, opacity: 0.85 }}>{r}</Text>
                  ))}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      );
    })()}

    {/* Overlay — confirmar eliminação de transação */}
    <Modal
      visible={deleteTxId !== null}
      transparent
      animationType="none"
      onRequestClose={() => setDeleteTxId(null)}
    >
      <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }]} onPress={() => setDeleteTxId(null)}>
        <Pressable style={styles.modal} onPress={() => {}}>
          <Text style={styles.modalTitle}>Delete Transaction</Text>
          <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            Are you sure? The portfolio will be recalculated.
          </Text>
          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setDeleteTxId(null)}>
              <Text style={styles.modalCancelTxt}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirmBtn, { backgroundColor: '#ef4444' }]}
              onPress={() => { deleteTransaction(deleteTxId!); setDeleteTxId(null); }}
            >
              <Text style={styles.modalConfirmTxt}>Delete</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    {/* Overlay — editar transação */}
    <Modal
      visible={editTx !== null}
      transparent
      animationType="none"
      onRequestClose={() => setEditTx(null)}
    >
      <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }]} onPress={() => setEditTx(null)}>
        <Pressable style={styles.modal} onPress={() => {}}>
          <Text style={styles.modalTitle}>Editar {editTx?.type === 'buy' ? 'Compra' : 'Venda'}</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="Nº de ações"
            placeholderTextColor="#64748b"
            keyboardType="numeric"
            value={editShares}
            onChangeText={(t) => setEditShares(t.replace(',', '.'))}
          />
          <TextInput
            style={styles.modalInput}
            placeholder={`Preço (${nativeCurrencySymbol})`}
            placeholderTextColor="#64748b"
            keyboardType="numeric"
            value={editPrice}
            onChangeText={(t) => setEditPrice(t.replace(',', '.'))}
          />
          <TextInput
            style={styles.modalInput}
            placeholder="Data (DD/MM/AAAA)"
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
            value={editDateStr}
            onChangeText={(t) => setEditDateStr(formatDateInput(t))}
          />
          <TextInput
            style={styles.modalInput}
            placeholder={`Taxa de corretagem (${nativeCurrencySymbol})`}
            placeholderTextColor="#64748b"
            keyboardType="numeric"
            value={editFee}
            onChangeText={(t) => setEditFee(t.replace(',', '.'))}
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEditTx(null)}>
              <Text style={styles.modalCancelTxt}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalConfirmBtn} onPress={confirmEditTx}>
              <Text style={styles.modalConfirmTxt}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 18 },
  tickerBadge: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center' },
  tickerText: { color: '#6366f1', fontWeight: 'bold', fontSize: 15 },
  logoImg: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#1e293b' },
  symbolText: { color: '#f8fafc', fontWeight: '700', fontSize: 18 },
  nameText: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  priceText: { color: '#f8fafc', fontWeight: '700', fontSize: 20 },
  priceSecondary: { color: '#8f99aa', fontWeight: '400', fontSize: 13 },
  dailyChange: { fontSize: 13, marginTop: 2 },
  marketBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#431407' },
  marketBadgePost: { backgroundColor: '#1e3a5f' },
  marketBadgeRegular: { backgroundColor: '#14532d' },
  marketBadgeClosed: { backgroundColor: '#1e293b' },
  marketBadgeTxt: { color: '#fb923c', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  chartWrapper: { position: 'relative' },
  crosshairTooltip: { position: 'absolute', top: 8, left: 16, backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  crosshairDate: { color: '#94a3b8', fontSize: 11 },
  crosshairPrice: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  periodsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  periodBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  periodBtnActive: { backgroundColor: '#334155' },
  periodTxt: { color: '#64748b', fontWeight: '600', fontSize: 13 },
  periodTxtActive: { color: '#f8fafc' },
  periodPerfRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  periodPerfLabel: { color: '#8f99aa', fontSize: 14 },
  periodPerfValue: { fontWeight: '700', fontSize: 15 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabTxt: { color: '#8f99aa', fontSize: 11, fontWeight: '600' },
  tabTxtActive: { color: '#f5f7fa' },
  tabContent: { paddingHorizontal: 16, paddingTop: 8 },
  desktopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  desktopLeft: { flex: 6, minWidth: 0 },
  desktopRight: { flex: 4, minWidth: 0, borderLeftWidth: 1, borderLeftColor: '#1e293b' },
  fundSection: { color: '#8f99aa', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.1, marginTop: 16, marginBottom: 8, marginLeft: 4 },
  fundCard: { backgroundColor: '#1b2023', borderRadius: 14, borderWidth: 1, borderColor: '#303841', overflow: 'hidden' },
  fundRowSep: { height: 1, backgroundColor: '#1b2026', marginHorizontal: 16 },
  fundRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1b2026' },
  fundLabel: { color: '#c3cad5', fontSize: 14 },
  fundValue: { color: '#f5f7fa', fontSize: 14, fontWeight: '700', textAlign: 'right', maxWidth: '55%' },
  fundValueAccent: { color: '#22c55e' },
  descCard: { backgroundColor: '#1b2023', borderRadius: 14, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#313942' },
  descText: { color: '#cfd6e0', fontSize: 14, lineHeight: 20 },
  descToggle: { marginTop: 8, alignSelf: 'flex-start' },
  descToggleTxt: { color: '#c3cad5', fontSize: 13, fontWeight: '600' },
  tagsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  tag: { backgroundColor: '#23282d', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#303841' },
  tagTxt: { color: '#c3cad5', fontSize: 13, fontWeight: '600' },
  emptyText: { color: '#8f99aa', textAlign: 'center', marginTop: 40, fontSize: 15 },

  infoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24, zIndex: 999, elevation: 99 },
  infoCard: { backgroundColor: '#1b2023', borderRadius: 18, padding: 24, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: '#303841' },
  infoTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  infoSep: { height: 1, backgroundColor: '#2a3036', marginBottom: 14 },
  infoDesc: { color: '#cfd6e0', fontSize: 15, lineHeight: 23 },
  infoCloseBtn: { marginTop: 20, alignSelf: 'flex-end', backgroundColor: '#6366f1', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  infoCloseTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  earningsCard: { backgroundColor: '#1b2023', borderRadius: 14, overflow: 'hidden', marginTop: 12, borderWidth: 1, borderColor: '#303841' },
  earningsHeader: { backgroundColor: '#171c1f' },
  earningsHeaderTxt: { color: '#8f99aa', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  earningsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  earningsRowFuture: { backgroundColor: '#1e2d45' },
  earningsCell: { flex: 1, color: '#f1f5f9', fontSize: 13, textAlign: 'center' },
  earningsDateTxt: { color: '#f1f5f9', fontSize: 13, fontWeight: '500' },
  earningsBadge: { marginTop: 2, fontSize: 11, color: '#6366f1', fontWeight: '700', textTransform: 'uppercase' },
  // Analistas
  consensusBadge: { borderRadius: 20, paddingHorizontal: 20, paddingVertical: 6, borderWidth: 1.5, marginBottom: 6 },
  consensusBadgeTxt: { fontSize: 18, fontWeight: '700' },
  analystTotal: { color: '#8f99aa', fontSize: 12, marginBottom: 14 },
  segBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 12 },
  segBarSegment: { height: '100%' },
  segLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  segLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  segLegendDot: { width: 8, height: 8, borderRadius: 4 },
  segLegendTxt: { color: '#94a3b8', fontSize: 12 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  histDateTxt: { color: '#8f99aa', fontSize: 11, width: 40 },
  histBar: { flex: 1, height: 14, flexDirection: 'row', borderRadius: 7, overflow: 'hidden', backgroundColor: '#0f172a' },
  histTotalTxt: { color: '#8f99aa', fontSize: 11, width: 28, textAlign: 'right' },
  gradeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#1b2023' },
  gradeCompany: { color: '#f5f7fa', fontSize: 14, fontWeight: '600' },
  gradeDate: { color: '#8f99aa', fontSize: 11, marginTop: 2 },
  gradeAction: { fontSize: 12, fontWeight: '700' },
  gradeTag: { fontSize: 12, fontWeight: '600' },
  divGridRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16 },
  divGridCell: { flex: 1 },
  divGridLabel: { color: '#8f99aa', fontSize: 12, marginBottom: 4 },
  divGridValue: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  divDivider: { height: 1, backgroundColor: '#0f172a', marginHorizontal: -16 },
  divGrowthRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 10 },
  divGrowthYear: { color: '#f8fafc', fontSize: 15, fontWeight: '700', width: 56 },
  divGrowthBadge: { backgroundColor: '#1e3a5f', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  divGrowthBadgeTxt: { color: '#94a3b8', fontSize: 12 },
  divGrowthPct: { marginLeft: 'auto' as const, fontSize: 15, fontWeight: '700' },
  // Price target
  ptTrack: { height: 10, backgroundColor: '#0f172a', borderRadius: 5, overflow: 'visible', position: 'relative', marginVertical: 6 },
  ptFill: { height: '100%', backgroundColor: '#6366f130', borderRadius: 5, position: 'absolute', top: 0, left: 0 },
  ptMarker: { position: 'absolute', top: -4, width: 4, height: 18, borderRadius: 2, marginLeft: -2 },
  ptRangeLabel: { color: '#8f99aa', fontSize: 11 },
  ptLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ptLegendDot: { width: 8, height: 8, borderRadius: 4 },
  ptLegendTxt: { color: '#94a3b8', fontSize: 12 },
  ptItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  ptTargetValue: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#262d33', backgroundColor: '#1b2023' },
  txBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  txBadgeTxt: { fontSize: 12, fontWeight: '700' },
  txShares: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  txDate: { color: '#8f99aa', fontSize: 12, marginTop: 2 },
  txPrice: { color: '#bcc5d1', fontSize: 14 },
  txActionsRow: { flexDirection: 'row', alignItems: 'center' },
  txActionEdit: { width: 72, gap: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: '#3b82f6', alignSelf: 'stretch' },
  txActionDelete: { width: 72, gap: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ef4444', alignSelf: 'stretch' },
  txActionTxt: { color: '#fff', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24, zIndex: 100 },
  modal: { backgroundColor: '#1b2023', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#303841', maxWidth: 480, width: '100%', alignSelf: 'center' },
  modalTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700', marginBottom: 16 },
  modalInput: { backgroundColor: '#171c1f', color: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 15, borderWidth: 1, borderColor: '#2a3036' },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalCancelBtn: { flex: 1, padding: 12, backgroundColor: '#2a3036', borderRadius: 8, alignItems: 'center' },
  modalCancelTxt: { color: '#c3cad5', fontWeight: '600' },
  modalConfirmBtn: { flex: 1, padding: 12, backgroundColor: '#6366f1', borderRadius: 8, alignItems: 'center' },
  modalConfirmTxt: { color: '#fff', fontWeight: '600' },
  newsCard: { backgroundColor: '#1b2023', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#303841' },
  newsTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '600', lineHeight: 21 },
  newsMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  newsPublisher: { color: '#6366f1', fontSize: 12, fontWeight: '600' },
  newsDate: { color: '#8f99aa', fontSize: 12 },
  aiNewsSection: { marginBottom: 14 },
  aiNewsBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1b2023', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 1, borderColor: '#7c3aed' },
  aiNewsBtnText: { color: '#a78bfa', fontSize: 14, fontWeight: '600' },
  aiNewsCard: { backgroundColor: '#1b2023', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#7c3aed' },
  aiNewsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  aiNewsHeaderText: { flex: 1, color: '#a78bfa', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  aiNewsBody: { color: '#cbd5e1', fontSize: 14, lineHeight: 22 },
});
