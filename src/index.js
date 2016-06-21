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

const drafts = {
    "draft-3": [
        "salad/schema_salad/metaschema/metaschema.yml",
        "CommandLineTool.yml",
        "Process.yml",
        "Workflow.yml"
    ],
    "draft-4": [
        "salad/schema_salad/metaschema/metaschema_base.yml",
        "salad/schema_salad/metaschema/metaschema.yml",
        "CommandLineTool.yml",
        "Process.yml",
        "Workflow.yml"

    ]
};

let rootOutput = "tmp";
for (let draftName of Object.keys(drafts)) {

    let output = path.resolve(`${rootOutput}/${draftName}`);
    mkdirp.sync(output);

    let entries = {};

    drafts[draftName].forEach(filename => {
        const absPath = path.resolve(`../common-workflow-language/${draftName}/${filename}`);

        const fileContent = fs.readFileSync(absPath, readConfig);
        const graph = yaml.safeLoad(fileContent, {json: true}).$graph;

        graph.filter(node => node.type === "record" || node.type === "enum")
            .forEach(node => entries[node.name] = node);
    });

    let nameTokens = Object.keys(entries);

    for (let name in entries) {
        const record = entries[name];
        const fileName = `${record.name}.ts`;
        let compiled = "";

        if (record.type === "enum") {
            compiled = makeEnum(record, nameTokens);
        } else {
            compiled = makeInterface(record, nameTokens);
        }

        fs.writeFileSync(`${output}/${fileName}`, compiled);
    }
}

function parseTypes(field, includes) {
    let types = field.types || field.type;
    if (!Array.isArray(types)) {
        types = [types];
    }

    function scan(type) {
        if (["int", "float", "double", "long"].indexOf(type) !== -1) {
            return "number";
        }

        if (type === "Any") {
            return "any";
        }

        if (typeof type === "string") {
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
    if(record.extends){
        data.symbols = data.symbols.concat(parseTypes({types: [record.extends]}, data.includes));
    }

    return ejs.render(fs.readFileSync("./stubs/enum.stub.ejs", readConfig), data);
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
        if (typeof data.extends === "string") {
            data.extension = resolveTokenName(data.extends, data.includes);
        } else if (Array.isArray(data.extends)) {
            data.extension = data.extends.map(ext => resolveTokenName(ext, data.includes)).join(", ");
        }
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
        field.type = parseTypes(field, data.includes);

    });

    data.includes = data.includes
        .map(name => name.replace(/[\[\]\?]/, ""))
        .filter((item, index, arr) => {
            return arr.indexOf(item) === index && item !== data.name
                && nameTokens.indexOf(item) !== -1
        });


    return ejs.render(fs.readFileSync("./stubs/interface.stub.ejs", readConfig), data);
}


