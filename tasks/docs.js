const fs = require('fs');
const typedoc = require('typedoc');
const handlebars = require('handlebars');

function getClassInfos(json, name) {
  const methods = [];

  for (const mod of json.children) {
    if (mod.children) {
      for (const item of mod.children) {
        if (item.name === name) {
          for (const method of item.children) {
            if (method.kindString === 'Method' && !method.flags.isPrivate) {
              methods.push(mapMethod(method, item));
            }
          }
        }
      }
    }
  }

  return methods;
}

function mapMethod(method, clazz) {
  return {
    ...method,
    signatures: method.signatures.map(s => mapMethodSignature(s, clazz))
  }
}

function mapMethodSignature(signature, clazz) {
  const examples =
    signature.comment &&
    signature.comment.tags &&
    signature.comment.tags
      .filter(tag => tag.tag === 'example')
      .map(tag => tag.text.trim())
  let description = signature.comment && signature.comment.shortText
  if (signature.comment && signature.comment.text) {
    description += '\n\n' + signature.comment.text
  }
  return {
    ...signature,
    fullName: stringifyMethod(signature, clazz),
    description,
    examples,
    parameters: signature.parameters && signature.parameters.map(param => ({
      ...param,
      comment: param.comment && {
        ...param.comment,
        text: param.comment.text && param.comment.text.trim(),
      },
      typeName: stringifyType(param.type),
    }))
  }
}

function stringifyMethod(signature) {
  const { type, name, typeParameter, parameters } = signature
  return name +
      stringifyTypeParameters(typeParameter) +
      stringifyParameters(parameters) +
      ': ' +
      stringifyType(type)
}

function stringifyTypeParameters(typeParameters) {
  if (typeParameters && typeParameters.length) {
    return `<${typeParameters.map(p => p.name).join(', ')}>`
  } else {
    return ''
  }
}

function stringifyTypeArguments(typeArgs) {
  if (typeArgs && typeArgs.length) {
    return `<${typeArgs.map(stringifyType).join(', ')}>`
  } else {
    return ''
  }
}

function stringifyParameters(parameters = []) {
  return '(' + parameters.map(stringifyParameter).join(', ') + ')'
}

function stringifyParameter(param) {
  const buf = [param.name];
  if (param.flags.isOptional) {
    buf.push('?')
  }
  buf.push(': ')
  buf.push(stringifyType(param.type))
  if (param.defaultValue) {
    buf.push(` = ${param.defaultValue.trim()}`)
  }
  return buf.join('')
}

function stringifyType(type) {
  if (type.type === 'reflection') {
    if (type.declaration.signatures && type.declaration.signatures.length) {
      // Function type
      const signature = type.declaration.signatures[0]
      if (signature.kindString === 'Call signature') {
        const { type, parameters, typeParameter } = signature
        return stringifyTypeParameters(typeParameter) +
            stringifyParameters(parameters) +
            ' => ' +
            stringifyType(type)
      }
      throw new Error('Not supported reflection type kind: ' + signature.kindString)
    }
    if (type.declaration.children) {
      // Object type
      return '{ ' + type.declaration.children.map(child =>
        `${child.name}: ${stringifyType(child.type)}`
      ).join(', ') + '}'
    }
    console.log(type);
    throw new Error('Not supported reflection type format: more than one signature.')
  }
  if (type.type === 'reference') {
    return type.name + stringifyTypeArguments(type.typeArguments)
  }
  if (type.type === 'intrinsic' || type.type === 'typeParameter' || type.type === 'unknown') {
    return type.name
  }
  if (type.type === 'union') {
    return type.types.map(stringifyType).join(' | ')
  }
  if (type.type === 'array') {
    return stringifyType(type.elementType) + '[]'
  }
  if (type.type === 'tuple') {
    return '[' + type.elements.map(stringifyType).join(', ') + ']'
  }
  console.log(type);
  throw new Error('Not supported type type: ' + type.type)
}

// Setup our TypeDoc app
var app = new typedoc.Application({
  name: 'My Awesome App',
  externalPattern: './index.ts',
  exclude: '**/__tests__/*.ts',
  tsconfig: 'tsconfig.json'
});

const outPath = '.temp/docs.json'

// Actually generate the JSON file
app.generateJson(['src/index.ts'], outPath);

const json = JSON.parse(fs.readFileSync(outPath, 'utf8'));

const templateFile = './docs/template/class.hbs'
const targetFolder = './docs/generated'

handlebars.registerHelper('json', (obj) => JSON.stringify(obj, null, 2))

const templateSrc = fs.readFileSync(templateFile).toString();
const template = handlebars.compile(templateSrc);

if (!fs.existsSync(targetFolder)){
  fs.mkdirSync(targetFolder);
}

const classes = [{ name: 'Stream', path: 'stream' }]

for (const { name, path } of classes) {
  const markdown = template({
    name,
    methods: getClassInfos(json, name)
  });

  fs.writeFileSync(`${targetFolder}/${path}.mdx`, markdown);
}
