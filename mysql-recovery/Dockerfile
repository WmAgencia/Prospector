FROM mysql:8.0
RUN command -v gzip >/dev/null 2>&1 || (microdnf install -y gzip && microdnf clean all)
COPY --chmod=755 inspect-entrypoint.sh /usr/local/bin/consecom-mysql-entrypoint
ENTRYPOINT ["/usr/local/bin/consecom-mysql-entrypoint"]
CMD ["mysqld"]
