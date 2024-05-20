#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { program } = require("commander");

function getDefaultBookmarkPath(profileKey) {
  const homeDir = os.homedir();
  let userDataPath;
  switch (os.platform()) {
    case "win32":
      userDataPath = path.join(homeDir, "AppData", "Local", "Google", "Chrome", "User Data");
      break;
    case "darwin":
      userDataPath = path.join(homeDir, "Library", "Application Support", "Google", "Chrome");
      break;
    default:
      userDataPath = path.join(homeDir, ".config", "google-chrome", "User Data");
      break;
  }
  return path.join(userDataPath, profileKey, "Bookmarks");
}

function getLocalStatePath() {
  const homeDir = os.homedir();
  switch (os.platform()) {
    case "darwin":
      return path.join(homeDir, "Library", "Application Support", "Google", "Chrome", "Local State");
    case "win32":
      return path.join(homeDir, "AppData", "Local", "Google", "Chrome", "User Data", "Local State");
    case "linux":
      return path.join(homeDir, ".config", "google-chrome", "Local State");
    default:
      console.error("Unsupported OS. Local State path is not available.");
      return null;
  }
}

function loadJSONFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        const json = JSON.parse(data);
        resolve(json);
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

function loadBookmarks(filePath) {
  return loadJSONFile(filePath).then((json) => json.roots);
}

function convertChromeDate(chromeDate) {
  const microsecondsPerMillisecond = 1000;
  const epochDifference = 11644473600000;
  return new Date(chromeDate / microsecondsPerMillisecond - epochDifference);
}

function formatAndPrintBookmarks(bookmarks, format) {
  switch (format) {
    case "raw":
      console.log(JSON.stringify(bookmarks, null, 2));
      break;
    case "csv":
      console.log(toCSV(bookmarks));
      break;
    case "text":
      bookmarks.forEach((bm) =>
        console.log(
          `${bm.name}: ${bm.url} (added on ${bm.date_added}) in ${bm.folder_path}, Profile: ${bm.profile_name}`
        )
      );
      break;
    case "markdown":
      console.log(
        bookmarks
          .map(
            (bm) =>
              `- [${bm.name}](${bm.url}) added on ${bm.date_added} in _${bm.folder_path}_, Profile: _${bm.profile_name}_`
          )
          .join("\n")
      );
      break;
    case "json":
    default:
      console.log(JSON.stringify(bookmarks, null, 2));
      break;
  }
}

function flattenBookmarks(node, parentPath, profileDetails) {
  let bookmarks = [];
  Object.values(node).forEach((child) => {
    if (child.type === "folder") {
      const folderPath = parentPath + child.name + "/";
      bookmarks = bookmarks.concat(flattenBookmarks(child.children, folderPath, profileDetails));
    } else if (child.type === "url") {
      bookmarks.push({
        name: child.name,
        url: child.url,
        date_added: convertChromeDate(child.date_added).toISOString(),
        guid: child.guid,
        type: child.type,
        folder_name: parentPath.split("/").slice(-2, -1)[0],
        folder_path: parentPath.slice(0, -1),
        profile_name: profileDetails.name,
        profile_email: profileDetails.user_name,
      });
    }
  });
  return bookmarks;
}

function toCSV(bookmarks) {
  const headers = "Name,URL,Date Added,GUID,Type,Folder Name,Folder Path,Profile Name,Profile Email";
  const rows = bookmarks.map(
    (bm) =>
      `"${bm.name}","${bm.url}","${bm.date_added}","${bm.guid}","${bm.type}","${bm.folder_name}","${bm.folder_path}","${bm.profile_name}","${bm.profile_email}"`
  );
  return [headers, ...rows].join("\n");
}

const bookmarksCmd = program.command("bookmarks");

bookmarksCmd
  .command("list")
  .description("List Chrome bookmarks from all profiles")
  .option("-f, --format <type>", "Output format (json, csv, text, raw, markdown)", "json")
  .action(async (options) => {
    try {
      const localStatePath = getLocalStatePath();
      const localState = await loadJSONFile(localStatePath);
      const profileInfo = localState.profile.info_cache;

      // Gather all bookmark loading promises
      const bookmarkPromises = Object.keys(profileInfo).map((profileKey) => {
        const profileDetails = profileInfo[profileKey];
        const bookmarksPath = getDefaultBookmarkPath(profileKey);
        return loadBookmarks(bookmarksPath)
          .then((bookmarks) => flattenBookmarks(bookmarks, "", profileDetails))
          .catch((err) => console.error(`Failed to load bookmarks for profile ${profileKey}: ${err.message}`));
      });

      // Execute all promises concurrently
      const bookmarksArrays = await Promise.all(bookmarkPromises);
      const allBookmarks = bookmarksArrays.reduce((acc, bookmarks) => acc.concat(bookmarks || []), []);

      formatAndPrintBookmarks(allBookmarks, options.format);
    } catch (error) {
      console.error("Error:", error.message);
    }
  });

program.version("1.0.0").description("CLI tool for interacting with Chrome resources");

program.parse(process.argv);
