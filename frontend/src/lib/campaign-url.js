export const getCampaignPath = (campaign) => {
  const key = campaign?.slug || campaign?._id;
  return key ? "/campaign/" + encodeURIComponent(String(key)) : "/campaigns";
};
