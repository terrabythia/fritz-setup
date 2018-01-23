var https = require('https');
var prompt = require('prompt');
var request = require('request');
var zlib = require('zlib');
var fs = require('extfs');
var Q = require('q');

var sys = require('sys');
var exec = require('child_process').exec;

var chalk = require('chalk');

var wrench = require('wrench'),
    util = require('util');

var AdmZip = require('adm-zip');

function compare_versions(a, b) {
    if (a === b) {
        return 0;
    }

    var a_components = a.split(".");
    var b_components = b.split(".");

    var len = Math.min(a_components.length, b_components.length);

    // loop while the components are equal
    for (var i = 0; i < len; i++) {
        // A bigger than B
        if (parseInt(a_components[i]) > parseInt(b_components[i])) {
            return 1;
        }

        // B bigger than A
        if (parseInt(a_components[i]) < parseInt(b_components[i])) {
            return -1;
        }
    }

    // If one's a prefix of the other, the longer one is greater.
    if (a_components.length > b_components.length) {
        return 1;
    }

    if (a_components.length < b_components.length) {
        return -1;
    }

    // Otherwise they are the same.
    return 0;
}


var downloadHelper = function(url, options) {

    var deferred = Q.defer();

    var _data = null;
    request.get(url, options)
        .on('response', function(res) {

            res.on('data', function(data) {
                if (null === data) {
                    _data = data;
                }
                else {
                    data += data;
                }
            });

            res.on( 'end', function(){
                deferred.resolve(data);
            });

        });

    return deferred.promise;

};


var fritzSetup = function() {

    // TODO: first check if it is maybe an existing Fritz project
    // search for .env file? Deze moet er wel altijd zijn eigenlijk...

    var project_dir = process.cwd();
    var EXISTING_PROJECT = false;

    if (fs.existsSync(project_dir + '/.env')) {
        EXISTING_PROJECT = true;
    }

    var schema = {
        properties: {
            project_name: {
                description: 'Enter you project\'s work-name',
                default: '',
                pattern: /^[a-zA-Z0-9\-_]+$/,
                message: 'Project name be only letters, dashes or underscores',
                required: true
            },
            project_title: {
                description: 'Enter you project\'s title',
                default: '',
                required: true
            },
            bitbucket_account: {
                description: 'Enter the Bitbucket account',
                default: 'frismedia',
                pattern: /^[a-zA-Z\s\-_]+$/,
                message: 'Account name be only letters, spaces, dashes or underscores',
                required: true
            },
            bitbucket_username: {
                description: 'Enter your Bitbucket username',
                default: '',
                pattern: /^[a-zA-Z\s\-_]+$/,
                message: 'Username must be only letters, spaces, dashes or underscores',
                required: true
            },
            bitbucket_password: {
                description: 'Enter your Bitbucket password',
                required: true,
                hidden: true
            }
        }
    };

    if (EXISTING_PROJECT) {
        delete schema.properties.project_name;
        delete schema.properties.project_title;
    }

    prompt.start();

    prompt.get(schema, function (err, result) {

        if (err) {
            console.log("\n");
            return;
        }

        project_dir = process.cwd();
        var project_dir_parts = project_dir.split('/'),
        project_dir_name = project_dir_parts[project_dir_parts.length-1];

        var project_dir_created = false;
        if (project_dir_name !== result.project_name) {
            project_dir += '/' + result.project_name;
            if (fs.existsSync(project_dir) && !fs.isEmptySync(project_dir)) {
                console.log('The project dir is not empty!');
                return;
            }
            else if (!fs.existsSync(project_dir)) {
                fs.mkdirSync(project_dir);
                project_dir_created = true;
            }
        }

        console.log('Downloading latest version of the base project...');
        var tmpFilePath = './tip.zip';
        request.get('https://bitbucket.org/'+result.bitbucket_account+'/frismedia_library_2016/get/tip.zip', {
            'auth': {
                'user': result.bitbucket_username,
                'pass': result.bitbucket_password,
                'sendImmediately': true
            }
        }).on('response', function(res){

            res.on('data', function(data) {
                fs.appendFileSync(tmpFilePath, data)
            });

            res.on( 'end', function(){
                // go on with processing
                console.log('Download completed.');
                console.log('Extracting...');

                var zip = new AdmZip(tmpFilePath);

                var entries = zip.getEntries(),
                    parts = entries[0].entryName.split('/'),
                    basename = parts[0] + '/base_project';

                entries.forEach(function(entry) {
                    if (entry.entryName.indexOf(basename) !== -1) {
                        var entryPathParts = entry.entryName.replace(basename + '/', '/').split('/');
                        entryPathParts.pop();
                        zip.extractEntryTo(entry, project_dir + entryPathParts.join('/'), false, true);
                    }
                });

                fs.unlinkSync(tmpFilePath);
                console.log('Extracting completed. Project initiated.');

                console.log('Downloading latest version of the Frismedia Library...');

                // TODO: library hoeft misschien ook helemaal niet want die wordt door composer ge-installeerd...

                request.get('https://api.bitbucket.org/2.0/repositories/'+result.bitbucket_account+'/frismedia_library_2016/refs/tags?pagelen=100', {
                    'auth': {
                        'user': result.bitbucket_username,
                        'pass': result.bitbucket_password,
                        'sendImmediately': true
                    }
                }, function(error, response, body) {
                    var data = JSON.parse(body),
                        latest = "0.0.0";
                    //console.log(body);
                    data.values.forEach(function(tag) {
                        //console.log("tagname: " + tag.name);
                        if ("tip" !== tag.name && compare_versions(tag.name, latest) !== -1) {
                            latest = tag.name;
                        }
                    });
                    console.log('Latest version is ' + latest + '. Downloading...');

                    // De eerste keer halen we wel de fris library op, want die bevat de updater die daarna gebruikt kan worden voor fris library updates
                    var tmpFilePath = './library.zip';
                    request.get('https://bitbucket.org/'+result.bitbucket_account+'/frismedia_library_2016/get/'+latest+'.zip', {
                        'auth': {
                            'user': result.bitbucket_username,
                            'pass': result.bitbucket_password,
                            'sendImmediately': true
                        }
                    }).on('response', function(res){

                        res.on('data', function(data) {
                            fs.appendFileSync(tmpFilePath, data)
                        });

                        res.on( 'end', function(){

                            console.log('Download completed.');
                            console.log('Extracting...');

                            var zip = new AdmZip(tmpFilePath);

                            var entries = zip.getEntries(),
                                parts = entries[0].entryName.split('/'),
                                basename = parts[0] + '/library';

                            entries.forEach(function(entry) {
                                if (entry.entryName.indexOf(basename) !== -1) {
                                    var entryPathParts = entry.entryName.replace(basename + '/', '/').split('/');
                                    entryPathParts.pop();
                                    zip.extractEntryTo(entry, project_dir + '/vendor/frismedia/' + entryPathParts.join('/'), false, true);
                                }
                            });

                            fs.unlinkSync(tmpFilePath);

                            // create info.json file for later updates
                            var versionInfo = {
                                version: latest
                            };

                            fs.writeFile(project_dir + '/vendor/frismedia/info.json', JSON.stringify(versionInfo));

                            console.log('Extracting completed.');
                            console.log('Setting up your htaccess and environment file...');

                            if (fs.existsSync(project_dir + '/TEMPLATE.env')) {
                                var env_contents = fs.readFileSync(project_dir + '/TEMPLATE.env', {
                                    encoding: 'utf8'
                                });
                                env_contents = env_contents.replace('{{website_title}}', result.project_title);
                                env_contents = env_contents.replace('{{project_name}}', result.project_name);
                                env_contents = env_contents.replace('{{db_name}}', result.project_name);
                                fs.writeFileSync(project_dir + '/.env', env_contents, {
                                    encoding: 'utf8'
                                });
                            }

                            if (fs.existsSync(project_dir + '/DEFAULT/TEMPLATE.htaccess')) {
                                var htaccess_contents = fs.readFileSync(project_dir + '/DEFAULT/TEMPLATE.htaccess', {
                                    encoding: 'utf8'
                                });
                                var project_base = project_dir.split('/');
                                var workspace_and_project = project_base[project_base.length-2] + '/' + project_base[project_base.length-1];
                                htaccess_contents = htaccess_contents.replace('{{project_base}}', workspace_and_project);
                                fs.writeFileSync(project_dir + '/DEFAULT/.htaccess', htaccess_contents, {
                                    encoding: 'utf8'
                                });
                            }

                            // create (possibly) empty dirs that the framework needs
                            var dirs_must_exist = [
                                '/storage/app',
                                '/storage/clockwork',
                                '/storage/debugbar',
                                '/storage/framework', '/storage/framework/cache', '/storage/framework/flatten', '/storage/framework/sessions', '/storage/framework/views',
                                '/storage/httpcache',
                                '/storage/logs',
                                '/storage/screenshots',
                                '/storage/uploads', '/storage/uploads/tmp',
                                '/uploads',
                                '/DEFAULT', '/DEFAULT/img', '/DEFAULT/img/cache'
                            ];

                            for (var i = 0; i < dirs_must_exist.length; i++) {
                                if (!fs.existsSync(project_dir + dirs_must_exist[i])) {
                                    fs.mkdirSync(project_dir + dirs_must_exist[i]);
                                }
                            }

                            // Recursively chmod the entire sub-tree of a directory
                            wrench.chmodSyncRecursive(project_dir + '/storage', 0777);
                            wrench.chmodSyncRecursive(project_dir + '/uploads', 0777);

                            require('dotenv').config({
                                silent: true,
                                path: project_dir + '/.env'
                            });

                            if (process.env && process.env.FILE_CACHE_PATH) {
                                if (!fs.existsSync(process.env.FILE_CACHE_PATH)) {
                                    fs.mkdirSync(process.env.FILE_CACHE_PATH);
                                }
                                wrench.chmodSyncRecursive(process.env.FILE_CACHE_PATH, 0777);
                            }

                            console.log("\n");
                            console.log('Your project is initiated. Follow the following steps to complete the setup:');

                            var step = 1;
                            console.log(chalk.bold(step + '. Create the database `' + result.project_name + '`.'));
                            step++;
                            if (project_dir_created) {
                                console.log(chalk.bold(step + '. Run `cd ' + result.project_name +'`'));
                                step++;
                            }
                            console.log(chalk.bold(step + '. Run `composer install` to install vendor dependencies.'));
                            step++;
                            console.log(chalk.bold(step + '. Run `php artisan key:generate` to generate a key for your application.'));
                            step++;
                            console.log(chalk.bold(step + '. Run `php artisan fritz-init-db` to setup the database tables.'));
                            step++;

                            console.log("\n");

                        });

                    });

                });


            });

        });

    });
};

module.exports.fritzSetup = fritzSetup;

