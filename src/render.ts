import { join, parse } from "path";
import * as nunjucks from "nunjucks";
import mjml2html = require('mjml');
import * as bluebird from 'bluebird';
import Helper from "./helper";

const Template = nunjucks.Template as any;


function translate(
  text: string,
  language: string,
  contextData: any
) {
  // variable replacement currently is broken when in env 'production'.
  // The current (temporary) fix is changing the env to development when rendering an email / subject line.
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const React = require('react');
  const ReactDOMServer = require('react-dom/server');
  const babel = require('@babel/standalone');
  const transformJs = require('@lingui/babel-plugin-transform-js');
  const transformReact = require('@lingui/babel-plugin-transform-react');
  const lingui = require('@lingui/react');
  const { setupI18n } = require('@lingui/core');

  const translations = {};
  translations[language] = { messages: {} };

  const i18n = setupI18n({
    language,
    catalogs: translations
  });

  // Transform JSX with babel to JS
  const options = {
    presets: ['react'],
    plugins: [transformJs, transformReact]
  };
  const transformed = babel
    .transform(
      `
    import {
      Trans, Plural, Select, SelectOrdinal, DateFormat, NumberFormat
    } from '@lingui/react'; // __TRASH_THIS__
    <React.StrictMode>
    <I18nProvider i18n={i18n}>
      ${text}
    </I18nProvider>
    </React.StrictMode>

    `,
      options
    )
    .code.split('\n')
    .filter(x => !/__TRASH_THIS__/gi.exec(x))
    .splice(1)
    .join('\n');

  const context = {
    travelsationLanguage: i18n.language, // this is just to reference i18n at least once in real ts-code rather than only babel
    React,
    process,
    ...lingui,
    ...contextData
  };

  // Eval JS to create React Elements
  const importsStr = Object.keys(context).join(',');
  const importsResolveStr = Object.keys(context).map(imp => `this.${imp}`);

  const code = `
      (function(${importsStr}) {
        return ${transformed};
      })(${importsResolveStr})
    `;
  const fn = function () {
    return eval(code);
  };
  const element = fn.call(context);

  const result = ReactDOMServer.renderToStaticMarkup(element);
  process.env.NODE_ENV = oldEnv;
  return result;
}


export function renderMjml(
  template: string,
  contextData: any = {},
  minify = false,
  beautify = true,
  fsPath?: string,
) {
  const data = {
    ...contextData,
    UNSUB_LINK: '[[UNSUB_LINK_DE]]',
    accountcontactinfo:
      'Travelsation, Tresckowstr. 54, Hamburg, Hamburg, 20253, Germany'
  };
  const env = nunjucks.configure({
    autoescape: true,
    throwOnUndefined: true
  });

  var tmpl: nunjucks.Template = new Template(
    template,
    env,
    fsPath,
    true
  );
  const templateRendered = tmpl.render(data);

  const styleStart = templateRendered.indexOf('<mj-style>');
  const styleEnd = templateRendered.indexOf('</mj-style>');
  const containsStyle = styleStart > -1 && styleEnd > -1;
  const style = containsStyle
    ? templateRendered.substring(styleStart + '<mj-style>'.length, styleEnd)
    : '';
  const templateRenderedStyleless = (containsStyle
    ? templateRendered.replace(style, '')
    : templateRendered
  )
    .split('&#39;')
    .join("'");

  const _console = console;
  global['console'] = undefined;

  let mjmlAfterReact;
  try {
    mjmlAfterReact = translate(
      templateRenderedStyleless,
      'de',
      data,
    ).replace('<mj-style></mj-style>', '<mj-style>' + style + '</mj-style>');
  } catch (e) {
    throw e;
  } finally {
    global['console'] = _console;
  }

  let { html, errors } = mjml2html(mjmlAfterReact, {
    level: "skip",
    filePath: fsPath || Helper.getPath(),
    minify,
    beautify,
    cwd: fsPath ? parse(fsPath).dir : Helper.getCWD()
  });

  if (errors && errors.length) {
    throw errors;
  }
  if (html) {
    return html;
  }

}
