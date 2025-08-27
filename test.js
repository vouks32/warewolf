
// import ffmpeg from "fluent-ffmpeg"
// import fs from "fs"
// const generateThumbnail = (inputPath, outputPath = "thumb.jpg") => {
//     return new Promise((resolve, reject) => {
//         ffmpeg(inputPath)
//             .on("end", () => resolve(fs.readFileSync(outputPath)))
//             .on("error", reject)
//             .screenshots({
//                 count: 1,
//                 filename: outputPath,
//                 folder: ".",
//                 size: "320x240"
//             })
//     })
// }

// generateThumbnail('./gifs/wolf2.gif')
let obj = { dog: "yes", cat: 'no' }
console.log(['yo', 'ya', 'yu'][Math.floor(Math.random() * 3)])