/**
 * Normalize Windows/exFAT readlink errors to the Windows/NTFS behavior.
 *
 * On exFAT, Node can report EISDIR (or EPERM for an open file) when readlink
 * is called on a normal, non-symlink file. Webpack expects EINVAL for that
 * case and otherwise aborts the production build. This preload changes only
 * that mismatched error and is a no-op on non-Windows platforms.
 */

if (process.platform === "win32") {
  const fs = require("node:fs");

  const isRegularPath = (path) => {
    try {
      return !fs.lstatSync(path).isSymbolicLink();
    } catch {
      return false;
    }
  };

  const normalize = (error, path) => {
    if (
      error &&
      (error.code === "EISDIR" || error.code === "EPERM") &&
      isRegularPath(path)
    ) {
      error.code = "EINVAL";
      error.errno = -4071;
    }
    return error;
  };

  const nativeReadlink = fs.readlink;
  fs.readlink = function readlink(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }

    const done = (error, link) => callback(normalize(error, path), link);
    return options === undefined
      ? nativeReadlink.call(this, path, done)
      : nativeReadlink.call(this, path, options, done);
  };

  const nativeReadlinkSync = fs.readlinkSync;
  fs.readlinkSync = function readlinkSync(path, options) {
    try {
      return nativeReadlinkSync.call(this, path, options);
    } catch (error) {
      throw normalize(error, path);
    }
  };

  const fsPromises = fs.promises;
  const nativePromiseReadlink = fsPromises.readlink.bind(fsPromises);
  fsPromises.readlink = async function readlink(path, options) {
    try {
      return await nativePromiseReadlink(path, options);
    } catch (error) {
      throw normalize(error, path);
    }
  };
}
