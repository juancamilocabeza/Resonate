// Helper to get the best available description for a track
// Priority: track.description > albumDescription > resultDescription
function getBestDescription(track, albumDescription, resultDescription) {
  if (track && track.description && track.description.trim() !== '') {
    console.log('[getBestDescription] Usando track.description:', track.description);
    return track.description.trim();
  }
  if (albumDescription && albumDescription.trim() !== '') {
    console.log('[getBestDescription] Usando albumDescription:', albumDescription);
    return albumDescription.trim();
  }
  if (resultDescription && resultDescription.trim() !== '') {
    console.log('[getBestDescription] Usando resultDescription:', resultDescription);
    return resultDescription.trim();
  }
  console.log('[getBestDescription] Sin descripción disponible');
  return '';
}
window.getBestDescription = getBestDescription;
