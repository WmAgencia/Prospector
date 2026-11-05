# Prospector: interface em tela cheia e contraste

## Pesquisa e decisões

Referências oficiais consultadas antes do refinamento:

- [Flowbite / Tailwind Landing Page](https://github.com/themesberg/tailwind-landing-page): organização de apresentação, benefícios, preço e chamadas para cadastro. Aplicação: promessa concreta no hero, demonstração do produto e CTA repetido nos momentos de decisão.
- [shadcn/ui](https://github.com/shadcn-ui/ui) e [tokens de tema](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/(root)/theming.mdx): componentes com papéis visuais consistentes. Aplicação: cores semânticas para superfícies, texto, ação, navegação e feedback.
- [Lucide](https://github.com/lucide-icons/lucide): SVGs com grade e traço consistentes. Foram incluídos somente 23 ícones usados pelo produto, do commit `ee8e10d746a10907205366cfd984922f0c58939a`. Licenças preservadas em `licenses/lucide.txt` e no próprio arquivo JavaScript público.
- [Motion](https://github.com/motiondivision/motion): referência para transições, timelines e estados interativos. As animações desta aplicação usam CSS e APIs nativas do navegador; a biblioteca não foi adicionada como dependência.

Não foram adotados templates com depoimentos inventados ou estatísticas de venda. A demonstração da landing é explicitamente ilustrativa, e o gráfico do painel usa os dados reais do Kanban.

## Fundações

Tema compartilhado: `dashboard/public/product-theme.css`.

| Papel | Cor | Contraste medido |
| --- | --- | --- |
| Texto principal em branco | `#112f23` / `#ffffff` | 14,44:1 |
| Texto de apoio em branco | `#425d4e` / `#ffffff` | 7,22:1 |
| Texto secundário em branco | `#536d5d` / `#ffffff` | 5,66:1 |
| Título branco no hero | `#ffffff` / `#073b2b` | 12,58:1 |
| Descrição clara no hero | `#d3e7d7` / `#073b2b` | 9,69:1 |
| Texto no botão verde-lima | `#123820` / `#baff59` | 10,88:1 |

As razões são dos pares indicados, não uma declaração de conformidade integral de todas as telas. Os estados de foco permanecem visíveis. O verde escuro identifica navegação e ações no sistema; o verde-lima destaca a ação principal da landing e os momentos de interesse na demonstração.

## Tela cheia

O contêiner do sistema tem margem externa zero, largura total e altura mínima de `100dvh`, sem borda, sombra ou arredondamento exterior. Cabeçalho, hero e rodapé da landing têm fundos que ocupam a largura inteira. A largura de leitura interna é limitada para manter a legibilidade; isso não cria uma moldura em volta da página. Cartões e formulários continuam com cantos arredondados como componentes.

## Gráficos e ícones

`product-icons.js` fornece SVGs locais para ambos os painéis e a landing. Não depende de uma CDN no momento da renderização. O painel mantém um fallback SVG para os testes e falhas de carregamento. O resumo visual do funil representa as contagens reais de abordagens, interessados e atendimentos, inclusive zero, sem valores fictícios.

## Movimento

O hero demonstra as três etapas: encontrar uma empresa, conversar e avisar o gestor. O usuário pode selecionar cada etapa, pausar e reproduzir novamente. A reprodução automática percorre a sequência uma vez e para; também pausa fora da área visível ou com a aba oculta.

As seções entram ao rolar, com transições de opacidade e deslocamento. O conteúdo permanece acessível sem JavaScript, pois a classe de entrada só é aplicada quando o recurso está disponível. `prefers-reduced-motion: reduce` desativa o movimento automático, mostra a demonstração completa e mantém o controle manual das etapas.

## Verificações

Chrome: margens e geometria da tela inteira, ausência de overflow em desktop e celular, controles da demonstração, preferência de movimento reduzido, navegação de master/cliente e cadastro abrindo o treinamento. Os testes existentes de funcionamento, autenticação e isolamento permanecem na suíte.
