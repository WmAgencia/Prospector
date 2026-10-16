# Pesquisa multirregional e catálogo de leads

A busca de empresas é independente da campanha de WhatsApp. Não altera horários
de abordagem, mensagens, mídias ou execução.

## Fontes e armazenamento

- **OpenStreetMap/Overpass**: busca automatizada a partir das 05h no fuso de São
  Paulo, com rotação de cidades e nichos configurados, limite de consultas da
  API comunitária e deduplicação de empresas. Fonte: © OpenStreetMap contributors (ODbL).
- **CNPJ/CNES**: importar CSV/JSON de fontes oficiais em lotes de até 5.000
  linhas, até 6 MB de CSV. Inclui CNPJ com 14 dígitos (ou campos
  cnpj_basico/cnpj_ordem/cnpj_dv), nome_fantasia/nome_empresarial, cidade,
  segmento e telefone quando presentes; campos porte/tipo/natureza_juridica
  e cnae são usados para a classificação. A cidade deve vir em texto, não um
  código numérico isolado. Os arquivos precisam ser obtidos legitimamente pelo operador.
- **Google Maps/Places API (New)**: pesquisa automatizada opcional por
  cidade e nicho, usando apenas \`places.id,nextPageToken\` no FieldMask.
  Persiste unicamente os Place IDs e metadados da pesquisa original (cidade,
  segmento, quando foi feita). **Não** copia nomes, telefones, endereços,
  avaliações ou sites do Google para o CRM. Consultas completas são transitórias
  pela tela Diretórios empresariais complementares e devem ter atribuição Google Maps.
  Preço e limites dependem do Google Cloud. É necessário habilitar o Places API
  (New), faturamento e a variável de ambiente GOOGLE_PLACES_API_KEY no Railway.
- **Brave/Foursquare**: consultas complementares existentes, dependentes de chave.

Leia e cumpra os termos do Google Maps Platform e apresente a atribuição
Google Maps ao exibir seus resultados:
https://developers.google.com/maps/documentation/places/web-service/policies

## Agendamento Google

\`google_places_auto_enabled = true\` e \`discovery_sources.google_places = true\`
habilitam a pesquisa após configurar a API. Por padrão são até 6 pesquisas
por dia, até 3 páginas de 20 IDs cada, e ao menos 30 minutos entre buscas.
\`google_daily_queries\` aceita 1–20. A pesquisa gira por combinações das
cidades e nichos já configurados; não requer seleção individual.

**Importante:** quantidade de IDs Google indexados NÃO é quantidade de
contatos próprios. Uma base permanente de milhares de empresas vem de
importações oficiais e fontes com direitos de armazenamento.

## Catálogo escalável

\`GET /api/catalog?city=Sorocaba&segment=Dentistas&quality=A&limit=60&offset=0\`
retorna registros paginados, até 200 por requisição.
\`GET /api/catalog/summary\` oferece contagem total, agrupamento por
cidade, nicho, tipo, origem e qualidade. Esses endpoints exigem a sessão
autenticada da aplicação em produção.

Qualidade A: telefone, cidade/nicho e oportunidade de melhoria da presença
web. Qualidade B: empresa com telefone. C: dados incompletos. São rótulos
heurísticos com pontuação explicável, não validação do potencial de compra
nem garantia de ausência de site.

## Mecanismo de decisão inspirado no projeto Jev

No histórico do usuário há referência ao "Prospector Decision Engine v1.0":
decisão contextual Choice/Score/Noul, confiança, rejeições, aprendizado
Naive Bayes opcional e instalação com PROSPECTOR_DECISION_ENGINE=1.
O pacote anterior NÃO foi embutido automaticamente nessa mudança.
Esta etapa incorpora infraestrutura de catalogação e pontuação. Para
integrar a implementação exata do Decision Engine é preciso validar os
arquivos originais do pacote/script e seus testes, sem presumir equivalência.
