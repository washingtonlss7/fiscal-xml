"""Gera tabela_st_es.csv (formato do painel) a partir das linhas extraídas da Portaria SEFAZ-ES 16-R/2019."""
import csv, re, sys

def num(v):
    v = v.strip().rstrip('%').strip()
    return None if not v else float(v.replace('.', '').replace(',', '.'))

def fmt(x):
    return '' if x is None else (f'{x:.2f}'.rstrip('0').rstrip('.')).replace('.', ',')

# O produto pode conter ";" — as 4 últimas colunas e as 2 primeiras são fixas.
linhas = []
for bruta in open('portaria_16R_2019_extraido.csv', encoding='utf-8').read().splitlines()[1:]:
    c = bruta.split(';')
    linhas.append({'segmento': c[0], 'item': c[1], 'produto': ';'.join(c[2:-4]), 'cest': c[-4], 'ncm': c[-3],
                   'mva_industria': c[-2], 'mva_distribuidor': c[-1]})
# Autopeças (seg. XIX) itens 1 a 65 e 129: todas com MVA 36,56% na extração
for i in list(range(1, 66)) + [129]:
    linhas.append({'segmento': 'XIX', 'item': str(i), 'produto': f'Autopeças – item {i}', 'cest': f'01.{i:03d}.00',
                   'ncm': '', 'mva_industria': '36,56%', 'mva_distribuidor': '36,56%'})

saida, vistos, puladas = [], {}, []
for l in linhas:
    if l['segmento'] == 'II' and l['item'] == '9':
        puladas.append('II-9 Refrigerantes pré-mix/post-mix (mesmo CEST 03.011.00 de "Demais refrigerantes"; ficou a MVA de demais)')
        continue
    mi, md = num(l['mva_industria']), num(l['mva_distribuidor'])
    if mi is None:
        puladas.append(f"{l['segmento']}-{l['item']} {l['produto']} (sem MVA na tabela)")
        continue
    origem = 'importado' if '(importados)' in l['produto'] else 'nacional' if '(de fabricação nacional)' in l['produto'] else ''
    for cest in re.findall(r'\d{2}\.\d{3}\.\d{2}', l['cest']):
        c = cest.replace('.', '')
        chave = (c, origem)
        if chave in vistos:
            sys.exit(f'CEST repetido: {c} {origem} ({vistos[chave]} e {l["segmento"]}-{l["item"]})')
        vistos[chave] = f"{l['segmento']}-{l['item']}"
        desc = f"{l['produto']} [Port. 16-R/2019 seg. {l['segmento']} item {l['item']}" + (f"; NCM {l['ncm']}]" if l['ncm'] else ']')
        saida.append([c, '', desc[:300], fmt(mi), fmt(md) if md is not None and md != mi else '', '', '17', origem])

with open('tabela_st_es.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, delimiter=';', lineterminator='\r\n')
    w.writerow(['cest', 'ncm', 'descricao', 'mva', 'mva_distribuidor', 'pmpf', 'aliquota_interna', 'origem'])
    w.writerows(saida)
print(len(saida), 'regras')
print('Fora da tabela:', len(puladas))
for p in puladas: print(' -', p)
