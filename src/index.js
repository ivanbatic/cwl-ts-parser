"use strict";

const path = require("path"),
    yaml = require("js-yaml"),
    fs = require("fs"),
    mkdirp = require("mkdirp"),
    ejs = require("ejs");

const readConfig = {
    encoding: "utf8",
    flag: "r"
};

const dirname = __dirname;

const drafts = {
    "v1.0": [
        "salad/schema_salad/metaschema/metaschema_base.yml",
        "salad/schema_salad/metaschema/metaschema.yml",
        "CommandLineTool.yml",
        "Process.yml",
        "Workflow.yml"
    ]
};

function generate(cwldir, outdir) {
    try {
        for (let draftName of Object.keys(drafts)) {

            let output = path.resolve(`${outdir}/${draftName}`);
            mkdirp.sync(output);

            let entries = {};

            drafts[draftName].forEach(filename => {
                const absPath = path.resolve(`${cwldir}/${draftName}/${filename}`);

                const fileContent = fs.readFileSync(absPath, readConfig);
                const graph = yaml.safeLoad(fileContent, {json: true}).$graph;

                graph.filter(node => node.type === "record" || node.type === "enum")
                    .forEach(node => {
                        node.parents = getParentTokens(node);
                        entries[node.name] = node;
                    });
            });

            for (let token in entries) {
                // Add Parents
                entries[token].parents = entries[token].parents.map(parentToken => entries[parentToken]);

                // Normalize types from hash maps to arrays
                if (entries[token].hasOwnProperty("fields") && !Array.isArray(entries[token].fields)) {
                    const fieldArray = [];

                    for (let name in entries[token].fields) {
                        fieldArray.push(Object.assign(entries[token].fields[name], {name}));
                    }
                    entries[token].fields = fieldArray;
                }
            }

            let nameTokens = Object.keys(entries);

            let unspecialized = nameTokens.slice();

            while (unspecialized.length > 0) {
                let cleanup = [];
                for (let i = 0; i < unspecialized.length; i++) {
                    let token = unspecialized[i];

                    let result = specializeTypes(entries[token]);
                    if (result === null) {
                        cleanup.push(i);
                    }
                }

                let newUnspecialized = unspecialized.filter((_, index) => {
                    return cleanup.indexOf(index) === -1;
                });

                if (newUnspecialized.length === unspecialized.length) {
                    console.error(`\n-----Could not specialize ${draftName} entries:\n`);
                    unspecialized.forEach(entry => {
                        let maps = entries[entry].specialize.map(ob => {
                            return Object.keys(ob).map(key => {
                                return `\n\t${key}: ${ob[key]}`;
                            });
                        }).join("\n\t");

                        console.error(`\n ${entry} -> ${maps}`);
                    });
                    break;
                }

                unspecialized = newUnspecialized;
            }

            let indexTpl = ``;

            for (let name in entries) {
                const record = entries[name];
                const fileName = `${record.name}.ts`;
                let compiled = "";

                specializeTypes(record);

                if (record.type === "enum") {
                    compiled = makeEnum(record, nameTokens);
                } else {
                    compiled = makeInterface(record, nameTokens);
                }

                fs.writeFile(`${output}/${fileName}`, compiled);
                indexTpl += `export * from "./${record.name}"\n`;
            }

            fs.writeFile(`${output}/index.ts`, indexTpl);


        }
    } catch (e) {
        console.error(e);
    }
}

function specializeTypes(entry) {
    if (!entry.specialize) {
        return null;
    }

    function findParentSpecFrom(entry, token) {
        let resolvedToken = resolveTokenName(token);

        for (let i in entry.fields) {
            let fieldTypes = parseTypes(entry.fields[i]);
            let found = fieldTypes.find((item) => {
                let variants = [
                    resolvedToken,
                    `${resolvedToken}[]`,
                    `${resolvedToken}?`,
                    `${resolvedToken}[]?`,
                    `Array<${resolvedToken}>`
                ];
                return variants.indexOf(item) !== -1;
            });
            if (found) {
                return Object.assign({}, entry.fields[i]);
            }
        }


        for (let parentIndex in entry.parents) {
            let spec = findParentSpecFrom(entry.parents[parentIndex], resolvedToken);
            if (spec) {
                return spec;
            }
        }

        return false;
    }

    if (!Array.isArray(entry.specialize)) {
        entry.specialize = [entry.specialize];
    }

    entry.specialize = entry.specialize.reduce((acc, spec) => {
        if (spec.hasOwnProperty("specializeFrom")) {
            return acc.concat(spec);
        }

        const newSpecs = [];
        for (let key in spec) {
            newSpecs.push({specializeFrom: key, specializeTo: spec[key]});
        }
        return acc.concat(newSpecs);
    }, []);

    let resolved = [];
    for (let i = 0; i < entry.specialize.length; i++) {
        let spec = entry.specialize[i];

        let newField = findParentSpecFrom(entry, spec.specializeFrom);

        if (newField) {

            let fromToken = resolveTokenName(spec.specializeFrom);
            let toToken = resolveTokenName(spec.specializeTo);

            let fieldTypes = newField.type || newField.types;
            if (!Array.isArray(fieldTypes)) {
                fieldTypes = [fieldTypes];
            }
            let replacedTypes = fieldTypes.map(type => {

                let regex = new RegExp(`(^|\s|<|#|sld:|xsd:|cwl:)${fromToken}`, "g");
                if (typeof type === "string") {
                    return type.replace(regex, toToken);
                }
                if (typeof type === "object") {

                    let update = Object.assign({}, type);

                    if (update.type === "array") {
                        let items = Array.isArray(update.items) ? update.items : [update.items];

                        update.items = items.map(item => item.replace(regex, toToken));
                    } else {
                        console.error("Unhandled specialization");
                        throw new Error("Unhandled case of enum property specialization.");
                    }
                    return update;
                }

                return type;
            });
            if (newField.type) {
                delete newField.type;
            }

            newField.types = replacedTypes;

            if (!entry.fields) {
                entry.fields = [newField];
            } else {
                let foundIndex = entry.fields.findIndex((field => field.name === newField.name));
                if (foundIndex !== -1) {
                    entry.fields[foundIndex] = newField;
                } else {
                    entry.fields.push(newField);
                }
            }
            resolved.push(i);
        }
    }
    entry.specialize = entry.specialize.filter((item, index) => resolved.indexOf(index) === -1);
    if (entry.specialize.length === 0) {
        delete entry.specialize;
        return null;
    }

    return false;


}

function parseTypes(field, includes) {
    let types = field.types || field.type;
    if (!Array.isArray(types)) {
        types = [types];
    }

    function scan(type) {

        if (typeof type === "string") {
            if (type.indexOf("Any") === 0) {
                return "any" + type.substr(3);
            }

            for (let n of ["int", "float", "double", "long"]) {
                if (type.indexOf(n) === 0) {
                    return "number" + type.substr(n.length);
                }
            }

            return resolveTokenName(type, includes);
        }

        if (typeof type === "object") {
            if (type.type === "array") {
                return "Array<" + parseTypes({types: type.items}, includes).join(" | ") + ">";
            }

            if (type.type === "enum") {
                return parseTypes({types: type.symbols}).map(i => `"${i}"`);
            }
        }
        return type;
    }

    return [...types.map(scan)];
}

function resolveTokenName(name, includes) {
    const sanitized = name.replace(/^(#|sld:|cwl:|xsd:)/, "");

    if (Array.isArray(includes)) {
        includes.push(sanitized);
    }

    return sanitized;
}

function makeEnum(record, nameTokens) {
    const data = Object.assign({
        name: "",
        doc: "",
        symbols: [],
        includes: []
    }, record);

    data.symbols = parseTypes({types: data.symbols}).map(type => `"${type}"`);
    if (record.extends) {
        data.symbols = data.symbols.concat(parseTypes({types: [record.extends]}, data.includes));
    }

    return ejs.render(fs.readFileSync(`${dirname}/stubs/enum.stub.ejs`, readConfig), data);
}

function getParentTokens(entry) {
    let parentTokens = [];
    if (typeof entry.extends === "string") {
        parentTokens = [resolveTokenName(entry.extends, entry.includes)];
    } else if (Array.isArray(entry.extends)) {
        parentTokens = entry.extends.map(ext => resolveTokenName(ext, entry.includes));
    }

    return parentTokens;
}

function makeInterface(record, nameTokens) {
    const data = Object.assign({
        fields: [],
        name: "",
        doc: "",
        extension: false,
        includes: []
    }, record);

    const docAsteriskExpansion = [/\n/gi, "\n * "];

    data.doc = data.doc.replace(...docAsteriskExpansion);
    if (data.extends) {
        data.extension = getParentTokens(data).join(", ");
        if (typeof data.extends === "string") {
            data.extension = resolveTokenName(data.extends, data.includes);
        } else if (Array.isArray(data.extends)) {
            data.extension = data.extends.map(ext => resolveTokenName(ext, data.includes)).join(", ");
        }
    }

    if (!Array.isArray(data.fields)) {
        const fieldArray = [];
        for (let name in data.fields) {
            fieldArray.push(Object.assign(data.fields[name], {name}));
        }
        data.fields = fieldArray;
    }

    data.fields.forEach(field => {
        field.doc = field.doc ? field.doc.replace(...docAsteriskExpansion) : "";
        field.isOptional = false;

        let parsedTypes = parseTypes(field, data.includes);

        if (parsedTypes[0] === "null") {
            field.isOptional = true;
            parsedTypes.shift();
        }

        parsedTypes.forEach((type, index, self) => {
            if (typeof type === "string" && type.charAt(type.length - 1) === "?") {
                self[index] = type.substr(0, type.length - 1);
                field.isOptional = true;
            }
        });

        field.type = parsedTypes.join(" | ");
    });

    data.includes = data.includes.map(name => name.replace(/((\[)?(\])?(\?)?)$/gi, ""))
        .filter((item, index, arr) => {
            return arr.indexOf(item) === index && item !== data.name
                && nameTokens.indexOf(item) !== -1
        });


    return ejs.render(fs.readFileSync(`${dirname}/stubs/interface.stub.ejs`, readConfig), data);
}

module.exports = {
    generate: generate
};