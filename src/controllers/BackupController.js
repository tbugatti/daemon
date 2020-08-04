const Request = require('request');
const { exec } = require('child_process');
const Mime = require('mime');
const Fs = require('fs-extra');
const _ = require('lodash');

const ConfigHelper = require('./../helpers/config');
const ResponseHelper = require('./../helpers/responses');

const Config = new ConfigHelper();

class ImportController {
    constructor(auth, req, res) {
        this.req = req;
        this.res = res;

        this.auth = auth;
        this.responses = new ResponseHelper(req, res);
    }

    // Backup
    backupCreate() {
        this.auth.allowed('s:backup', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            if ("name" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing name argument"});
            if ("folder" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing folder argument"});
            if ("backup_folder" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing backup_folder argument"});

            const fileName = this.req.params["name"];
            const folder = this.req.params["folder"];
            const backup_folder = this.req.params["backup_folder"];

            const auth = this.auth;
            const uuid = this.auth.server().uuid;
            const self = this;

            Fs.access('/' + backup_folder + '/', error => {
                if (error) {
                    this.res.send({"success": "false", "error": "Backup folder not found"});
                } else {
                    Fs.access('/' + backup_folder + '/' + uuid + '/' + fileName + '.tar.gz', error => {
                        if (!error) {
                            this.res.send({"success": "false", "error": "Backup in this name already exists"});
                        } else {
                            this.auth.server().suspend(err => {
                                exec('mkdir /' + backup_folder + '/' + uuid, function(err, stdout, stderr) {});

                                this.res.send({"success": "true"});

                                exec(`cd ${Config.get('sftp.path').toString()}/${uuid}${folder} && tar czf /${backup_folder}/${uuid}/${fileName}.tar.gz *`, (createErr, stdout, stderr) => {
                                    auth.server().unsuspend(err => {});

                                    let uri;
                                    createErr ? uri = 'failed' : uri = 'completed';

                                    self.responseToPanel(`backup/create/${uri}`, {server_uuid: uuid, name: fileName});
                                });
                            });
                        }
                    });
                }
            });
        });
    }

    backupRestore() {
        this.auth.allowed('s:backup', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            if ("name" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing name argument"});
            if ("folder" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing folder argument"});
            if ("backup_folder" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing backup_folder argument"});
            if ("file_type" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing file_type argument"});

            const fileName = this.req.params["name"];
            const folder = this.req.params["folder"];
            const backup_folder = this.req.params["backup_folder"];
            const file_type = this.req.params["file_type"];

            const uuid = this.auth.server().uuid;

            const res = this.res;
            const self = this;

            Fs.access('/' + backup_folder + '/' + uuid + '/' + fileName + '.' + file_type, error => {
                if (!error) {
                    this.auth.server().suspend(err => {
                        this.res.send({"success": "true"});

                        const auth = this.auth;

                        let command = `rm -r ${Config.get('sftp.path').toString()}/${uuid}${folder}* && `;

                        if (file_type === 'zip') {
                            command+= 'unzip -qo /' + backup_folder + '/' + uuid + '/' + fileName + '.zip -d ' + Config.get('sftp.path').toString() + '/' + uuid + folder;
                        } else {
                            command+= `tar xzf /${backup_folder}/${uuid}/${fileName}.${file_type} -C ${Config.get('sftp.path').toString()}/${uuid}${folder}`;
                        }

                        exec(command, (err, stdout, srderr) => {
                            auth.server().unsuspend(err => {});

                            if (err) {
                                console.log(err);
                            }

                            let uri;
                            err ? uri = 'failed' : uri = 'completed';

                            self.responseToPanel(`backup/restore/${uri}`, {server_uuid: uuid});
                        });
                    });
                } else {
                    res.send({"success": "false", "error": "File not found: " + fileName + '.' + file_type});
                }
            });
        });
    }

    backupDelete(uuid) {
        if ("name" in this.req.params === false)
            return this.res.send({"success": "false", "error": "Missing name argument"});
        if ("backup_folder" in this.req.params === false)
            return this.res.send({"success": "false", "error": "Missing backup_folder argument"});
        if ("file_type" in this.req.params === false)
            return this.res.send({"success": "false", "error": "Missing file_type argument"});

        const fileName = this.req.params["name"];
        const backup_folder = this.req.params["backup_folder"];
        const file_type = this.req.params["file_type"];

        const res = this.res;

        Fs.access('/' + backup_folder + '/' + uuid + '/' + fileName + '.' + file_type, error => {
            if (!error) {
                Fs.unlink('/' + backup_folder + '/' + uuid + '/' + fileName + '.' + file_type, (err) => {
                    if (err) {
                        res.send({"success": "false", "error": "Backup delete error"});
                    } else {
                        Fs.readdir('/' + backup_folder + '/' + uuid + '/', function(err, files) {
                            if (!err) {
                                if (!files.length) {
                                    Fs.rmdir('/' + backup_folder + '/' + uuid + '/', (err) => {});
                                }
                            }
                        });

                        res.send({"success": "true"});
                    }
                });
            } else {
                res.send({"success": "false", "error": "File not found: " + fileName + '.' + file_type});
            }
        });
    }

    backupDeleteUser() {
        this.auth.allowed('s:backup', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            const uuid = this.auth.server().uuid;

            this.backupDelete(uuid);
        });
    }

    backupDeleteAdmin() {
        this.auth.allowed('c:backup:delete', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            if ("uuid" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing uuid argument"});

            const uuid = this.req.params["uuid"];

            this.backupDelete(uuid);
        });
    }

    backupDeleteCommand() {
        this.auth.allowed('c:backup:delete:command', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            if ("uuids" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing uuids argument"});
            if ("backup_folder" in this.req.params === false)
                return this.res.send({"success": "false", "error": "Missing backup_folder argument"});

            const uuids = JSON.parse(this.req.params["uuids"]);
            const backup_folder = this.req.params["backup_folder"];

            Fs.readdir('/' + backup_folder + '/', (err, files) => {
                if (err) {
                    this.res.send({'success': "false", "error": "Backup folder not found"});
                } else {
                    files.forEach(file => {
                        if (uuids.indexOf(file) === -1) {
                            exec("rm -rd /" + backup_folder + "/" + file + "/", (err, stdout, stderr) => {})
                        }
                    });

                    this.res.send({'success': "true"});
                }
            });
        });
    }

    backupDownload() {
        Request(`${Config.get('remote.base')}/api/remote/backup/download-verify`, {
            method: 'POST',
            json: {
                token: this.req.params.token,
            },
            headers: {
                'Accept': 'application/vnd.pterodactyl.v1+json',
                'Authorization': `Bearer ${Config.get('keys.0')}`,
            },
            timeout: 5000,
        }, (err, response, body) => {
            if (err) {
                return this.res.send(500, { "error": "An error occured while attempting to perform this request." });
            }

            if (response.statusCode === 200) {
                try {
                    const json = _.isString(body) ? JSON.parse(body) : body;
                    if (!_.isUndefined(json) && json.path && json.name) {
                        const Server = this.auth.allServers();
                        if (_.isUndefined(Server[json.server])) {
                            return this.res.send(404, { 'error': 'No server found for the specified resource.' });
                        }

                        const uuid = json.server;
                        const fileName = json.path;
                        const origName = json.name;
                        const backup_folder = json.backup_folder;
                        const file_type = json.file_type;

                        const Mimetype = Mime.getType('/' + backup_folder + '/' + uuid + '/' + fileName + '.' + file_type);
                        const Stat = Fs.statSync('/' + backup_folder + '/' + uuid + '/' + fileName + '.' + file_type);
                        if (!Stat.isFile()) {
                            return this.res.send({"success": "false", "error": "Could not locate the requested file."});
                        }

                        this.res.writeHead(200, {
                            "Content-Disposition": "attachment; filename=" + origName + "." + file_type,
                            'Content-Type': Mimetype,
                            'Content-Length': Stat.size
                        });

                        const readStream = Fs.createReadStream('/' + backup_folder + '/' + uuid + '/' + fileName + '.' + file_type);
                        readStream.pipe(this.res);
                    } else {
                        return this.res.send(424, { 'error': 'The upstream response did not include a valid download path.' });
                    }
                } catch (ex) {
                    return this.res.send(500, { 'error': 'An unexpected error occured while attempting to process this request.' + ex });
                }
            } else {
                this.res.redirect(this.req.header('Referer') || Config.get('remote.base'), _.constant(''));
            }
        });
    }

    responseToPanel(uri, params) {
        Request(`${Config.get('remote.base')}/api/remote/${uri}`, {
            method: 'POST',
            json: params,
            headers: {
                'Accept': 'application/vnd.pterodactyl.v1+json',
                'Authorization': `Bearer ${Config.get('keys.0')}`,
            },
            timeout: 5000,
        }, (err, response, body) => {
            if (err) {
                return false;
            }

            return response;
        });
    }
}

module.exports = ImportController;
