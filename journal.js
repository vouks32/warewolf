import { Jimp, loadFont } from 'jimp';
import fs from 'fs';
import path from 'path';

async function insertImage() {
  // 1. Charger le modèle de journal
  const template = await Jimp.read("images/journal.png");

  // 2. Charger l'image à insérer
  const photo = await Jimp.read("images/death0.jpg");

  // 3. Définir les coordonnées et dimensions de la zone "IMAGE"
  // ⚠️ À ajuster selon la position réelle du cadre dans ton template
  const x = 20;   // position horizontale
  const y = 170;  // position verticale
  const width = 550;  // largeur du cadre image
  const height = 490; // hauteur du cadre image

  // 4. Redimensionner l'image à la taille du cadre
  photo.cover({w : width, h :height}) // garde le ratio tout en remplissant

  
  // 5. Paste it on the template
  template.composite(photo, x, y);

  // 6. Load a font (you can use Jimp.FONT_SANS_32_BLACK or WHITE, etc.)
  const font = await loadFont();

  // 7. Add text — example: “Community Cleanup Day”
  const text = "Community Cleanup Day";

  // 8. Define text position (adjust as needed)
  const textX = 60;
  const textY = 80;

  // 9. Print text on the image
  template.print(
    font,
    textX,
    textY,
    {
      text,
      alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
      alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
    },
    500, // max text width
    100  // max text height
  );
  
  // 5. Coller l'image dans le template
  template.composite(photo, x, y);

  // 6. Enregistrer le résultat final
  await template.write("images/journal_with_image.png");

  console.log("✅ Image insérée avec succès !");
}

insertImage().catch(console.error);
