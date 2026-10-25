import { ArrowUpLeft } from "lucide-react";
import { Link } from "react-router-dom";

const CategoryItem = ({ category }) => {
	return (
		<article className="group relative h-44 w-full overflow-hidden rounded-2xl bg-[#eceef2] sm:h-56 xl:h-64">
			<Link
				to={category.href}
				className="absolute inset-0 block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#ea580c]"
				aria-label={`مشاهده ${category.name}`}
			>
				<img
					src={category.imageUrl}
					alt=""
					className="h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
					loading="lazy"
					decoding="async"
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent transition-colors duration-300 group-hover:from-black/75" />
				<div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:gap-4 sm:p-6">
					<div>
						<h3 className="font-serif text-lg font-medium text-white sm:text-2xl">{category.name}</h3>
						<p className="mt-1 text-sm text-white/80">مشاهده قطعات</p>
					</div>
					<span className="mb-1 inline-flex h-9 w-9 shrink-0 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-white/60 text-white transition group-hover:border-white group-hover:bg-white group-hover:text-[#1c1f24]">
						<ArrowUpLeft size={19} aria-hidden="true" />
					</span>
				</div>
			</Link>
		</article>
	);
};

export default CategoryItem;
