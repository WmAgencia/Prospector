# Prospector — recuperação de bancos e validação de carga (piloto)

Este documento acompanha testes sem dados reais. Não comprova que backups
automáticos já estejam configurados no Railway e não restaura produção.

## Armazenamento persistente identificado

- prospector-operacional: volume prospector-persistent-data em /data
- wa-akg-mysql: volume wa-akg-mysql-data em /var/lib/mysql
- wa-akg: volume wa-akg-data em /app/data
- prospector-maps: volume prospector-maps-data em /tmp/gosomdata

Existe também o bucket prospector-media-archive. A presença do bucket
não comprova cópias dos bancos SQLite nem do MySQL.

## Agendamentos de backup nativos no Railway

No projeto prospector-consecom e ambiente production, abra a aba Backups de
cada serviço com volume; configure snapshots diários e semanais, confira
data e validade das últimas cópias. Inclua o volume do Prospector, a base
wa-akg-mysql e os dados de sessão wa-akg.

O recurso nativo do Railway permite snapshots agendados, mas a conexão
disponível nesta auditoria não permite consultar ou alterar tais agendamentos.
Não declare que estão habilitados sem comprovação na aba Backups.
Guia: https://docs.railway.com/volumes/backups

## Recuperação segura em homologação

Uma restauração nativa cria um novo volume e pode exigir remapeamento e
redeploy. Nunca acione Restore sobre a produção apenas para um teste.
Planeje restaurar uma cópia real em ambiente separado, verificando permissões,
integridade, conversas e arquivos antes de considerar o processo aprovado.

O teste tests/backup-restore-audit.test.mjs demonstra com dados fictícios:
- Cópia SQLite online que inclui transações WAL;
- Verificação da integridade com PRAGMA quick_check;
- Restauração em diretório de staging sem sobrescrever a origem;
- Isolamento entre bases de diferentes empresas;
- Falha segura para destino existente, origem ausente e arquivo corrompido.

Isso não substitui a recuperação real do volume ou do MySQL em Railway.

## Capacidade

O teste tests/tenant-concurrent-load-audit.test.mjs usa seis clientes
fictícios, cada um com processo e base individual, e endpoints de
treinamento, indicadores e contexto, sem envio WhatsApp. Os tempos de
CI não são equivalentes aos tempos garantidos em produção.

## Gate do teste real com duas empresas

Só declarar o piloto validado quando duas contas externas distintas
conectarem dois números pelo QR Code, confirmarem socket autenticado,
recebimento e resposta de teste permitida, e desconexão independente.
Os números internos da Consecom não contam como tenants externos.
