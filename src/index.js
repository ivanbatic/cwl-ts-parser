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
    names: ["draft-3", "draft-4"],
    files: [
        "salad/schema_salad/metaschema/metaschema.yml",
        "CommandLineTool.yml",
        "Process.yml",
        "Workflow.yml"
    ]
};

let rootOutput = "tmp";
for (let draftName of drafts.names) {

    let output = path.resolve(`${rootOutput}/${draftName}`);
    mkdirp.sync(output);

    drafts.files.forEach((filename) => {
        const absPath = path.resolve(`../common-workflow-language/${draftName}/${filename}`);
        const fileContent = fs.readFileSync(absPath, readConfig);
        const graph = yaml.safeLoad(fileContent, {json: true}).$graph;

        graph.filter(node => node.type !== "documentation").forEach(record => {
            const fileName = `${record.name}.ts`;
            let compiled = "";

            if (record.type === "enum") {
                compiled = makeEnum(record);
            } else {
                compiled = makeInterface(record);
            }

            fs.writeFileSync(`${output}/${fileName}`, compiled);
        });
    });
}

function parseTypes(field, includes) {
    let types = field.types || field.type;
    if (!Array.isArray(types)) {
        types = [types];
    }

    function scan(type) {
        if (["int", "float", "double", "long"].indexOf(type) !== -1) {
            return "Number";
        }

        if(type === "Any"){
            return "any";
        }

        if (typeof type === "string") {
            return sanitizeSchemaLink(type, includes);
        }

        if(typeof type === "object"){
            if(type.type === "array"){
                return "Array<" + parseTypes({types: type.items}, includes).join(" | ") + ">";
            }

            if(type.type === "enum"){
                return parseTypes({types: type.symbols}).map(i => `"${i}"`);
            }
        }
        return type;
    }

    let output = [...types.map(scan)];
    return output;

}

function sanitizeSchemaLink(name, includes) {
    const sanitized = name.replace(/^(#|sld:)/, "");

    if (Array.isArray(includes)) {
        if (name.charAt(0) === "#") {
            includes.push({
                token: sanitized,
                path: `./${sanitized}`
            });
        } else if (name.indexOf("sld:") === 0) {
            includes.push({token: sanitized, path: `./${sanitized}`});
        }

    }

    return sanitized;
}

function makeEnum(record) {
    const data = Object.assign({
        name: "",
        doc: "",
        symbols: []
    }, record);

    return ejs.render(fs.readFileSync("./stubs/enum.stub.ejs", readConfig), data);
}

function makeInterface(record) {
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
            data.extension = sanitizeSchemaLink(data.extends, data.includes);
        } else if (Array.isArray(data.extends)) {
            data.extension = data.extends.map(ext => sanitizeSchemaLink(ext, data.includes)).join(", ");
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
        field.type = parsedTypes.join(" | ");
        field.type = parseTypes(field, data.includes);

    });

    data.includes = data.includes
        .filter((item, index, arr) => arr.indexOf(item) === index);

    return ejs.render(fs.readFileSync("./stubs/interface.stub.ejs", readConfig), data);
}


