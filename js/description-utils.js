// Helper to get the best available description for a track
// Priority: track.description > albumDescription > resultDescription
function getBestDescription(track, albumDescription, resultDescription) {
  if (track && track.description && track.description.trim() !== '') {
    console.log('[getBestDescription] Using track.description:', track.description);
    return track.description.trim();
  }
  if (albumDescription && albumDescription.trim() !== '') {
    console.log('[getBestDescription] Using albumDescription:', albumDescription);
    return albumDescription.trim();
  }
  if (resultDescription && resultDescription.trim() !== '') {
    console.log('[getBestDescription] Using resultDescription:', resultDescription);
    return resultDescription.trim();
  }
  console.log('[getBestDescription] No description available');
  return '';
}
window.getBestDescription = getBestDescription;
