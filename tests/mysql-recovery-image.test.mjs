import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const docker=readFileSync(new URL('../mysql-recovery/Dockerfile',import.meta.url),'utf8');
const shell=readFileSync(new URL('../mysql-recovery/inspect-entrypoint.sh',import.meta.url),'utf8');
test('recovery image is the same MySQL major image and keeps official entrypoint',()=>{
 assert.match(docker,/FROM mysql:8\.0/);
 assert.match(shell,/exec docker-entrypoint\.sh mysqld --skip-log-bin/);
 assert.doesNotMatch(shell,/\brm\s|\btruncate\s|\bDROP\s|\bDELETE\s/i);
 assert.match(shell,/find \/var\/lib\/mysql.*'binlog\.\*'/);
});
