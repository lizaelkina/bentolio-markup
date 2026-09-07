import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Transform, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import gulp from 'gulp';
import * as dartSass from 'sass';
import gulpSass from 'gulp-sass';
import sourcemaps from 'gulp-sourcemaps';
import postcss from 'gulp-postcss';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import {SourceMapConsumer, SourceMapGenerator} from 'source-map-js';
import {replaceDirectory, slash} from './io.mjs';

const sass = gulpSass(dartSass);
const transform = action => new Transform({objectMode: true, transform(file, _encoding, callback) {
  try { action(file); callback(null, file); } catch (error) { callback(error); }
}});

export async function compileStyles({rootDir, outputDir, mode}) {
  const development = mode === 'development';
  const entries = [];
  const destination = path.join(outputDir, 'styles');
  const processors = [autoprefixer({env: mode})];
  if (!development) processors.push(cssnano({preset: ['default', {mergeRules: false}]}));
  const streams = [gulp.src(path.join(rootDir, 'src/styles/main.scss'), {base: rootDir})];
  if (development) streams.push(sourcemaps.init());
  streams.push(sass(), postcss(processors), transform(file => {
    if (file.sourceMap) {
      // PostCSS adds mappings for generated braces to the intermediate CSS.
      // Leave those segments unmapped instead of advertising a nonexistent source file.
      const consumer = new SourceMapConsumer(file.sourceMap);
      const generator = new SourceMapGenerator({file: 'main.css'});
      const intermediate = 'src/styles/main.css';
      consumer.eachMapping(mapping => {
        const generated = {line: mapping.generatedLine, column: mapping.generatedColumn};
        if (mapping.source && !slash(mapping.source).endsWith(intermediate) && mapping.originalLine != null) {
          generator.addMapping({generated, source: mapping.source, original: {line: mapping.originalLine, column: mapping.originalColumn}, name: mapping.name});
        } else generator.addMapping({generated});
      });
      for (const source of consumer.sources) {
        if (!slash(source).endsWith(intermediate)) generator.setSourceContent(source, consumer.sourceContentFor(source, true));
      }
      file.sourceMap = generator.toJSON();
      file.sourceMap.sources = file.sourceMap.sources.map(source => {
        let absolute;
        if (source.startsWith('file:')) absolute = fileURLToPath(source);
        else if (source.startsWith('data:')) absolute = path.join(rootDir, 'src/styles/main.scss');
        else {
          const decoded = decodeURI(source);
          absolute = path.isAbsolute(decoded) ? decoded : path.resolve(rootDir, decoded);
        }
        return slash(path.relative(destination, absolute));
      });
      file.sourceMap.file = 'main.css';
      delete file.sourceMap.sourceRoot;
    }
    file.base = destination;
    file.path = path.join(destination, 'main.css');
  }));
  if (development) streams.push(sourcemaps.write('.', {includeContent: true}));
  streams.push(new Writable({objectMode: true, write(file, _encoding, callback) {
    entries.push([file.relative, file.contents]);
    callback();
  }}));
  await pipeline(...streams);
  await replaceDirectory(destination, entries);
}
