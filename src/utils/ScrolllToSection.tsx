



export const scrollToSection = (sectionName : string) => {
    const element = document.getElementById(sectionName);

    if(element){
        element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}