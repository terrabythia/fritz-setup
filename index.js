var https = require('https');
var prompt = require('prompt');
var request = require('request');
var zlib = require('zlib');
var fs = require('extfs');

var wrench = require('wrench'),
    util = require('util');

var AdmZip = require('adm-zip');

// TODO: chmod dirs?
// TODO: use the project name for initialization
// TODO: maybe add the project to bitbucket?
// TODO: run the website and register what should be done before it can really run (and add it to fritz-setup)

// TODO: get from bitbucket?
// TODO: also auto install latest version of fris library
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

var fritzSetup = function() {
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
                default: 'FrisseSander',
                pattern: /^[a-zA-Z\s\-_]+$/,
                message: 'Username must be only letters, spaces, dashes or underscores',
                required: true
            },
            bitbucket_password: {
                description: 'Enter your Bitbucket password',
                required: true,
                hidden: true
            },
            bitbucket_repo: {
                description: 'Enter the base project\'s name',
                default: 'fritz_cms_base_project',
                required: true
            }
        }
    };


    prompt.start();

    prompt.get(schema, function (err, result) {

        if (err) {
            console.log("\n");
            return;
        }

        var project_dir = process.cwd(),
            project_dir_parts = project_dir.split('/'),
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
        request.get('https://bitbucket.org/'+result.bitbucket_account+'/'+result.bitbucket_repo+'/get/tip.zip', {
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
                    basename = parts[0];

                entries.forEach(function(entry) {
                    var entryPathParts = entry.entryName.replace(basename + '/', '/').split('/');
                    entryPathParts.pop();
                    zip.extractEntryTo(entry, project_dir + entryPathParts.join('/'), false, true);
                });

                fs.unlinkSync(tmpFilePath);
                console.log('Extracting completed. Project initiated.');

                console.log('Downloading latest version of the Frismedia Library...');

                // TODO: library hoeft misschien ook helemaal niet want die wordt door composer ge-installeerd...

                request.get('https://api.bitbucket.org/2.0/repositories/'+result.bitbucket_account+'/frismedia_library_2015/refs/tags', {
                    'auth': {
                        'user': result.bitbucket_username,
                        'pass': result.bitbucket_password,
                        'sendImmediately': true
                    }
                }, function(error, response, body) {
                    var data = JSON.parse(body),
                        latest = "0.0.0";
                    data.values.forEach(function(tag) {
                        if ("tip" !== tag.name && compare_versions(tag.name, latest) !== -1) {
                            latest = tag.name;
                        }
                    });
                    console.log('Latest version is ' + latest + '. Downloading...');

                    // De eerste keer halen we wel de fris library op, want die bevat de updater die daarna gebruikt kan worden voor fris library updates
                    var tmpFilePath = './library.zip';
                    request.get('https://bitbucket.org/'+result.bitbucket_account+'/frismedia_library_2015/get/'+latest+'.zip', {
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
                            console.log('Setting up your htaccess and environment file');

                            if (fs.existsSync(project_dir + '/TEMPLATE.env')) {
                                var contents = fs.readFileSync(project_dir + '/TEMPLATE.env', {
                                    encoding: 'utf8'
                                });
                                contents = contents.replace('{{project_name}}', result.project_name);
                                fs.writeFileSync(project_dir + '/.env', contents, {
                                    encoding: 'utf8'
                                });
                            }

                            if (fs.existsSync(project_dir + '/DEFAULT/TEMPLATE.htaccess')) {
                                var contents = fs.readFileSync(project_dir + '/DEFAULT/TEMPLATE.htaccess', {
                                    encoding: 'utf8'
                                });
                                var parts = project_dir.split('/');
                                var workspace_and_project = parts[parts.length-2] + '/' + parts[parts.length-1];
                                contents = contents.replace('{{project_base}}', workspace_and_project);
                                fs.writeFileSync(project_dir + '/DEFAULT/.htaccess', contents, {
                                    encoding: 'utf8'
                                });
                            }

                            schema = {
                                properties: {
                                    setup_db: {
                                        description: 'Do you want to setup the local database now?',
                                        type: 'boolean',
                                        default: true,
                                        required: true
                                    }
                                }
                            };

                            // TODO: auto setup the database...
                            //prompt.get(schema, function(err, result2) {
                            //    if (result2.setup_db) {
                            //        schema = {
                            //            properties: {
                            //                setup_db: {
                            //                    description: 'Do you want to setup the local database now?',
                            //                    type: 'boolean',
                            //                    default: true,
                            //                    required: true
                            //                }
                            //            }
                            //        }
                            //    };
                            //
                            //});

                            // Recursively chmod the entire sub-tree of a directory
                            wrench.chmodSyncRecursive(project_dir + '/storage', 0777);

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

                            if (!project_dir_created) {
                                console.log('Your project is ready. Run `composer update` to install vendor dependencies.');
                            }
                            else {
                                console.log('Your project is ready. Run `cd ' + result.project_name +'` and `composer update` to install vendor dependencies.');
                            }

                        });

                    });

                });


            });

        });

    });
};

module.exports.fritzSetup = fritzSetup;

