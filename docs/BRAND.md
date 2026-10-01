# BRAND — Identidade do Nosso After no site

> Levantamento feito em 30/09/2026. O projeto não tinha nenhum asset da marca e o repositório
> `CodeByRamos/Nosso-After` estava vazio, então a única fonte foi o Instagram público
> **@nossoafterguaruja** (bio, destaques e posts de jul–set/2026). Tudo o que não está nesses
> materiais aparece marcado como **hipótese**.

## 1. Evidências coletadas

| Fonte | O que mostra |
|---|---|
| Bio | "Nosso After" · **"O AFTER DE TODAS AS FESTAS"** · **"A N°1 do Guarujá 🥇"** · @redbullbr · @ingresse · @zig.fun · 6.429 seguidores |
| Post "Comemore seu aniversário aqui!" | Fundo preto com halftone; "NOSSO" branco; "AFTER" **pink** sobre **respingo amarelo**; quadro branco; grade de pontos pink; chevrons `››››` pink; listras diagonais amarelas; título em grotesca ultra-bold, uma cor por linha |
| Flyer "Submundo" (25.SET) | Logo com o slogan "A Nº1 DO GUARUJÁ"; data **"25 SET"** em branco; "SEXTA FEIRA • 23HR"; atração (DJ Blakes, "Só Mandelão Original"); faixa de vantagens ("Welcome Licor 43 · 50 primeiros", "Aniversariante do mês · VIP + 1"); patrocinadores; local "Lucky Scope — Praia do Guaiúba"; neon saturado e bordas gastas |
| Flyer "Baile do Glenner" (06.SET) | **O mesmo logo recolorido de vermelho**; "06.SET"; "FERIADO • DOMINGO • 23HR" entre filetes; "EVENTO PARA MAIORES DE 18 ANOS" na vertical |
| Flyer "Luuky" (28.AGO) | Logo recolorido em **dourado**; "28.AGO"; 18+ vertical |
| Post "Nova parceria · Zig" | Logo em versão azul monocromática, com textura de carimbo |
| Textos alternativos | "$5 E LICOR 43 PROS PRIMEIROS 50", RedBull × Nosso After, Absolut como apoio |

**Cores medidas nos pixels** (média do cluster, post "Comemore", JPEG do Instagram):
pink `#F52781` · amarelo `#F8E22F` · fundo `#040404`.

**Não encontrado:** o arquivo vetorial do logo, os nomes das fontes originais, manual de marca e
fotos em alta resolução. Por isso o logo do site é uma **reconstrução tipográfica** e precisa ser
trocado pelo SVG oficial (ver §6).

## 2. Identidade identificada

- **Logo:** "NOSSO" (condensada, branca) sobre a linha superior de um **quadro branco**; "AFTER"
  maior, condensado, muito pesado, com **textura gasta/carimbada** e **respingo amarelo** atrás; slogan
  em caixa-alta espaçada sobre a linha inferior. O "AFTER" **muda de cor a cada edição**
  (pink, vermelho, dourado, azul).
- **Paleta núcleo:** preto, branco, pink e amarelo. As cores extras pertencem a cada festa.
- **Grafismos recorrentes:** chevrons `››››`, listras de perigo `////`, grade de pontos, halftone,
  filetes finos ladeando a data, separador `•`.
- **Linguagem:** caixa-alta, imperativa e direta ("Comemore seu aniversário aqui!", "Veja os
  benefícios", "Sejam bem-vindos!"), com foco em **vantagens com escassez** ("50 primeiros").
- **Formato de data:** `DD.MMM` ("06.SET"), dia da semana e hora "23HR".
- **Posicionamento declarado:** *o after de todas as festas* (começa quando as outras acabam) e
  *a Nº1 do Guarujá*.

## 3. Público-alvo (hipóteses fundamentadas)

| Aspecto | Hipótese | Base |
|---|---|---|
| Idade | 18–28 anos | eventos 18+, linguagem, funk mandelão/MCs, contas universitárias marcadas |
| Região | Guarujá e Baixada Santista (DDD 013) | local Praia do Guaiúba; contas "mega_universitaria.013", "rocketbeachclub_pg" |
| Interesses | funk, trap/mandelão, vida noturna, aniversários em grupo | line-ups e vantagens |
| Comportamento digital | Instagram/Stories em primeiro lugar, quase tudo no **celular** | conteúdo concentrado em reels, stories e destaques |
| Gatilhos de compra | line-up, vantagem para os primeiros, VIP de aniversariante, preço do lote | flyers |
| Confiança | compra oficial, marcas parceiras, endereço claro, ingresso no celular | parceria com ticketeira e cashless |
| Expectativa do site | achar a data, o preço e comprar em segundos | hipótese |

## 4. Direção de arte → decisões

| Decisão | Por quê |
|---|---|
| Fundo **preto** quase puro, texto branco | É o fundo dos flyers; contraste de 20:1 |
| **Pink** `#F52781` como primária (CTAs, "AFTER") | Cor do "AFTER" na versão de marca; 5,3:1 no preto |
| Texto **preto** sobre botão pink | Branco sobre pink dá 3,5:1 e reprova no AA; preto dá 5,3:1 |
| **Amarelo** `#F8E22F` como acento (claim, foco, faixas, números) | Respingo e listras dos posts; 15:1 no preto |
| `--color-edition` por evento (campo **"Cor da edição"** no admin) | Reproduz o recolor do AFTER por festa. Cor ilegível no preto é recusada (< 4,5:1) |
| Cantos retos (raio 0–4 px), quadros de 2 px, sem pílulas | Flyers são retangulares, com fita e quadro |
| Ingresso como canhoto com picote | Linguagem física de ingresso e de flyer |
| Chevrons nos CTAs, faixa marquee com slogan/claim, listras, grade de pontos, halftone em CSS | Elementos recorrentes, sem nenhuma imagem extra |
| "EVENTO PARA MAIORES DE 18 ANOS" vertical | Igual aos flyers |
| Removido: paleta "pôr do sol / mar / areia" da Fase 1 | **Foi inventada por mim sem evidência**; não pertence à marca |

**Movimento:** só marquee (CSS), deslize dos chevrons no hover e transições de cor. Tudo desligado com
`prefers-reduced-motion`. Sem parallax nem animações de scroll: a marca é impressa e estática, e o
público está no celular.

**Imagens:** a arte do evento nunca é cortada (ela carrega data e line-up): caixa 4:5 (formato do
feed), `object-contain` sobre preto, sombra deslocada na cor da edição, quadro branco.

## 5. Tokens (`src/app/globals.css` · `@theme`)

| Token | Valor | Papel |
|---|---|---|
| `--color-bg` | `#050505` | fundo |
| `--color-surface` / `-2` | `#0e0e0e` / `#171717` | cartões, campos |
| `--color-line` | `#2a2a2a` | bordas neutras |
| `--color-fg` / `-2` | `#fff` / `#d4d4d4` | texto / texto secundário |
| `--color-muted` | `#a3a3a3` | legendas (8:1) |
| `--color-primary` | `#f52781` | marca, CTA |
| `--color-on-primary` | `#050505` | texto sobre pink |
| `--color-accent` | `#f8e22f` | destaque, foco (`:focus-visible` 3 px) |
| `--color-edition` / `--color-on-edition` | por evento (padrão: pink/preto) | cor da festa |
| `--color-success` / `-danger` / `-warning` | `#2ee59d` / `#ff4d4d` / `#f8e22f` | feedback |
| `--font-display` | Anton | lettering tipo logo |
| `--font-sans` | Archivo (variável: largura 62–125, peso 100–900) | títulos, datas, corpo |
| `--radius-xs…lg` | 1–6 px | cantos retos |

**Papéis tipográficos:** `.type-display` (Anton, logo e nomes de festa), `.type-headline` (Archivo 900,
largura 80, títulos de flyer), `.type-date` (Archivo 800, largura 125, "25.SET"), `.type-label`
(Archivo 700, caixa-alta espaçada, "SEXTA-FEIRA • 23H").
**Componentes de marca:** `src/components/brand/brand.tsx` (LogoLockup, FlyerDate, Chevrons,
BrandMarquee, AgeStamp, Sticker) e `.btn`, `.field`, `.frame`, `.hazard`, `.dot-grid`, `.tex-halftone`, `.distress`.

**Fontes:** as originais **não foram identificadas** (não há arquivo nem nome). Alternativas escolhidas:
- **Anton** para o "AFTER": grotesca condensada e muito pesada, com proporções próximas do logo.
- **Archivo variável** para os títulos ultra-bold dos posts, as datas largas e o corpo. A Inter, usada
  antes, foi removida por ser genérica.

Peso: cerca de 102 KB de fontes pré-carregadas (subset latin), `display: swap`.

## 6. Pendências que dependem da marca

1. **Logo oficial em SVG** (e versões monocromáticas) para substituir o `LogoLockup` reconstruído.
2. **Nome e arquivos das fontes** usadas nos flyers, se forem licenciáveis para web.
3. **Hospedagem das artes:** hoje o admin aceita uma URL https da arte. O ideal é upload para storage
   próprio + `next/image` (WebP/AVIF, tamanhos responsivos), limitando os hosts no CSP.
4. **Fotos de festa** (multidão, palco) em boa resolução, para o hero quando não houver arte.
5. Confirmar se as marcas parceiras podem aparecer no site. Hoje não aparecem: não há autorização.
