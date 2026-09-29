# Tabela de ST do ES

`tabela_st_es.csv` é carregada pelo painel na primeira vez que a tabela `st_es_regras` estiver vazia.
Depois disso, a tabela é mantida pelo painel (Auditoria → "Enviar tabela (CSV)").

**Fonte:** Portaria SEFAZ-ES nº 16-R, de 11/04/2019 (MVA de mercadorias sujeitas à ST), indicada pela
SEFAZ-ES em "MVA / PMPF / PCF / PMC". Texto extraído da cópia publicada em contabeis.com.br
(`portaria_16R_2019_extraido.csv`); `gerar_tabela_st.py` converte para o formato do painel.

**Colunas:** MVA indústria/importador (`mva`) e MVA distribuidor (`mva_distribuidor`). O sistema escolhe
pela nota: CFOP de produção própria (x101, x401, x151...) ou importação direta (origem 1/6) = indústria;
os demais = distribuidor.

**Não incluídos (conferir na portaria atualizada):**
- Seg. XIX Autopeças, itens 66 a 128 (MVA não veio na extração).
- Seg. XXI Materiais de construção a partir do item 50 (a cópia da portaria termina no item 49).
- Seg. XIV Veículos e seg. XII protetores/câmaras de ar (sem MVA na tabela).
- Seg. II item 9 (refrigerante pré-mix): mesmo CEST de "demais refrigerantes"; ficou a MVA de demais.
- PMC de medicamentos (Portaria 06-R/2019), PMPF de combustíveis e PCF de bebidas não estão aqui.

A SEFAZ-ES também publica a "Relação de Produtos, Protocolos e Convênios ST (atualizado 24/04/2024)",
que indica quais produtos continuam na ST. Vale cruzar com esta tabela.
