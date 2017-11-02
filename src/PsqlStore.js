const url = require('url');
const pg = require('pg');

const BULK_SIZE = 1000;

class PsqlStore {

  constructor(uri, search_path) {
    let params = url.parse(uri);
    this.search_path = search_path;
    let auth = params.auth.split(':');
    this.config = {
      user: auth[0],
      password: auth[1],
      host: params.hostname,
      port: params.port,
      database: params.pathname.split('/')[1],
      max: 5,
      idleTimeoutMillis: 30000,
      Client: class extends pg.Client {
        getStartupConf() {
          return Object.assign(super.getStartupConf(), {
            search_path: search_path,
          });
        }
      }
    };

    this.pgPool = new pg.Pool(this.config);
    this.pgPool.on('error', (err) => {
      console.error('idle client error', err.message, err.stack);
    });
  }

  initialize(CREATE_TABLES) {
    return new Promise((fulfil, reject) => {
      this.execute("CREATE SCHEMA IF NOT EXISTS " + this.search_path, []).then(() => {
        if (CREATE_TABLES) {
          this.execute(CREATE_TABLES, []).then(() => {
            fulfil();
          }).catch((err) => reject(err));
        } else {
          fulfil();
        }
      }).catch((err) => reject(err));
    });
  }

  execute(query, args) {
    return new Promise((fulfil, reject) => {
      this.pgPool.connect((err, client, done) => {
        if (err) { reject(err); }
        else {
          let x = client.query(query, args, (err, result) => {
            if (err) { reject(err); }
            else {
              fulfil(result);
            }
            done(err);
          });
        }
      });
    });
  }

  bulkinsert(table, columns, bulkargs) {
    return new Promise((fulfil, reject) => {
      if (bulkargs.length == 0) {
        reject("empty arguments");
        return;
      }
      this.pgPool.connect((err, client, done) => {
        if (err) { reject(err); }
        else {
          let do_batch = (i, rowCount) => {
            if (i >= bulkargs.length) {
              done();
              fulfil({rowCount: rowCount});
            } else {

              let slice = bulkargs.slice(i, i + BULK_SIZE);
              let args = [];
              let values = [];
              let query = "INSERT INTO " + table + "(" + columns.join(", ") + ") VALUES ";
              for (let j = 0; j < slice.length; j++) {
                if (slice[j].length != columns.length) {
                  done();
                  reject("Incorrect argument size");
                  return;
                }
                let dollars = [];
                slice[j].forEach((arg) => {
                  args.push(arg);
                  dollars.push("$" + args.length);
                });
                values.push("(" + dollars.join(", ") + ")");
              }
              query += values.join(", ");
              client.query(query, args, (err, result) => {
                if (err) {
                  done(err);
                  reject(err);
                }

                do_batch(i + BULK_SIZE, rowCount + result.rowCount);
              });
            }
          };
          do_batch(0, 0);
        }
      });
    });
  }

  bulkdelete(table, columns, bulkargs) {
    return new Promise((fulfil, reject) => {
      if (bulkargs.length == 0) {
        reject("empty arguments");
        return;
      }
      this.pgPool.connect((err, client, done) => {
        if (err) { reject(err); }
        else {
          let do_batch = (i) => {
            if (i >= bulkargs.length) {
              done();
              fulfil();
            } else {

              let slice = bulkargs.slice(i, i + BULK_SIZE);
              let args = [];
              let wheres = [];
              let query = "DELETE FROM " + table + " WHERE ";
              for (let j = 0; j < slice.length; j++) {
                if (slice[j].length != columns.length) {
                  done();
                  reject("Incorrect argument size");
                  return;
                }
                let where = [];
                for (let k = 0; k < slice[j].length; k++) {
                  args.push(slice[j][k]);
                  where.push(columns[k] + " = $" + args.length);
                }
                wheres.push("(" + where.join(" AND ") + ")");
              }
              query += wheres.join(" OR ");
              client.query(query, args, (err) => {
                if (err) {
                  done(err);
                  reject(err);
                }

                do_batch(i + BULK_SIZE);
              });
            }
          };
          do_batch(0);
        }
      });
    });
  }

  fetch(query, args) {
    return new Promise((fulfil, reject) => {
      this.execute(query, args).then((result) => {
        fulfil(result.rows || []);
      }).catch((err) => reject(err));
    });
  }

  fetchrow(query, args) {
    return new Promise((fulfil, reject) => {
      this.execute(query, args).then((result) => {
        fulfil(result.rows.length > 0 ? result.rows[0] : null);
      }).catch((err) => reject(err));
    });
  }

  fetchval(query, args) {
    return new Promise((fulfil, reject) => {
      this.execute(query, args).then((result) => {
        if (result.rows.length > 0) {
          let row = result.rows[0];
          let keys = Object.keys(row);
          if (keys.length > 0) {
            fulfil(row[keys[0]]);
          } else {
            fulfil(null);
          }
        } else {
          fulfil(null);
        }
      }).catch((err) => reject(err));
    });
  }


}

module.exports = PsqlStore;
