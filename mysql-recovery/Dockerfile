FROM mysql:8.0
COPY --chmod=755 inspect-entrypoint.sh /usr/local/bin/consecom-mysql-entrypoint
ENTRYPOINT ["/usr/local/bin/consecom-mysql-entrypoint"]
CMD ["mysqld"]
