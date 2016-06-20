"use strict";

const path = require("path"),
    yaml = require("js-yaml"),
    fs = require("fs"),
    mkdirp = require("mkdirp"),
    ejs = require("ejs");

const cltPath = path.resolve("../common-workflow-language/draft-3/CommandLineTool.yml");

const readConfig = {
    encoding: "utf8",
    flag: "r"
};


let drafts = {
    names: ["draft-3", "draft-4"],
    files: [
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

function parseTypes(field) {
    let types = field.types || field.type;
    if (!Array.isArray(types)) {
        types = [types];
    }

    function scan(type) {
        if (["int", "float", "double", "long"].indexOf(type) !== -1) {
            return "Number";
        }

        if (typeof type === "string") {
            return sanitizeSchemaLink(type);
        }

        if (typeof type === "object" && type.type === "array") {
            return "Array<" + parseTypes({types: type.items}).join(" | ") + ">";
        }
        return type;
    }

    let output = [...types.map(scan)];
    return output;

}

function sanitizeSchemaLink(name) {
    return name.replace(/^(#|sld:)/, "");
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
        extension: false
    }, record);

    const docAsteriskExpansion = [/\n/gi, "\n * "];

    data.doc = data.doc.replace(...docAsteriskExpansion);
    if (data.extends) {
        if (typeof data.extends === "string") {
            data.extension = sanitizeSchemaLink(data.extends);
        } else if (Array.isArray(data.extends)) {
            data.extension = data.extends.map(sanitizeSchemaLink).join(", ");
        }
    }

    data.fields.forEach(field => {
        field.doc = field.doc ? field.doc.replace(...docAsteriskExpansion) : "";
        field.isOptional = false;


        let parsedTypes = parseTypes(field);
        if (parsedTypes[0] === "null") {
            field.isOptional = true;
            parsedTypes.shift();
        }
        field.type = parsedTypes.join(" | ");
        field.type = parseTypes(field);

    });

    return ejs.render(fs.readFileSync("./stubs/interface.stub.ejs", readConfig), data);
}


